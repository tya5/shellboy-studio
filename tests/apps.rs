//! The gateway's app hosting over real listeners, with a scripted owner. Every app here is a throwaway
//! written into a temp folder by the test; the product ships none.
mod common;
use base64::Engine;
use common::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use shellboy::protocol::{ApiError, Command, ErrorCode};
use shellboy_studio::{
    auth::Auth,
    hub::Hub,
    server::{AppState, ServerConfig, Shared, serve},
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use tokio_util::sync::CancellationToken;

struct Reply {
    status: u16,
    headers: String,
    body: String,
}

async fn http(addr: &str, method: &str, path: &str, extra: &[(&str, &str)], body: &str) -> Reply {
    let mut request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (k, v) in extra {
        request.push_str(&format!("{k}: {v}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.unwrap();
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (headers, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    Reply {
        status: headers
            .split_whitespace()
            .nth(1)
            .unwrap_or("0")
            .parse()
            .unwrap(),
        headers: headers.to_owned(),
        body: body.to_owned(),
    }
}

async fn raw(addr: &str, request: String) -> u16 {
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut seen = [0u8; 64];
    let n = stream.read(&mut seen).await.unwrap();
    String::from_utf8_lossy(&seen[..n])
        .split_whitespace()
        .nth(1)
        .unwrap_or("0")
        .parse()
        .unwrap()
}

/// What the fake owner knows of an artifact: its Thread and its latest version.
#[derive(Clone)]
struct Registered {
    thread: String,
    title: String,
    uri: String,
    mime: Option<String>,
    version: i64,
}

type Registry = Arc<Mutex<BTreeMap<String, Registered>>>;

struct Fixture {
    root: PathBuf,
    /// Where the apps' folders are: anywhere the Thread put them.
    apps: PathBuf,
    registry: Registry,
    /// When set, the fake owner refuses every `artifact.read` with this code.
    read_fault: Arc<Mutex<Option<ErrorCode>>>,
    addr: std::net::SocketAddr,
    state: AppState<MockOwner>,
    owner: Arc<MockOwner>,
    cancel: CancellationToken,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.cancel.cancel();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl Fixture {
    fn register(&self, id: &str, thread: &str, title: &str, uri: String, mime: Option<&str>) {
        let mut registry = self.registry.lock().unwrap();
        let version = registry.get(id).map_or(1, |known| known.version + 1);
        registry.insert(
            id.to_owned(),
            Registered {
                thread: thread.to_owned(),
                title: title.to_owned(),
                uri,
                mime: mime.map(str::to_owned),
                version,
            },
        );
    }
}

/// An app: a folder with files, registered as a `shellboy-app:` artifact of `thread` whose ID is `name`.
fn write_app(f: &Fixture, name: &str, thread: &str, files: &[(&str, &str)]) {
    let dir = f.apps.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    for (file, text) in files {
        let path = dir.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    f.register(
        name,
        thread,
        name,
        format!("shellboy-app:{}", dir.display()),
        None,
    );
}

const PAGE: (&str, &str) = (
    "index.html",
    "<!doctype html><html><head><title>t</title></head><body>hello</body></html>",
);

fn summary(id: &str, known: &Registered) -> Value {
    json!({"artifact_id": id, "thread_id": known.thread, "created_at": "now", "updated_at": "now",
        "latest": {"version": known.version, "uri": known.uri, "title": known.title, "mime": known.mime, "created_at": "now"}})
}

fn refused(code: ErrorCode, message: &str) -> Option<common::Reply> {
    Some(Err(ApiError::new(code, message)))
}

/// What Core does with `artifact.read`, as far as these tests need it: a `shellboy-app:` folder serves
/// regular files by relative path and refuses paths and links that leave it; any other URI is one file.
fn read_artifact(known: &Registered, path: Option<&str>) -> Option<common::Reply> {
    let source = if let Some(folder) = known.uri.strip_prefix("shellboy-app:") {
        let Some(path) = path else {
            return refused(ErrorCode::InvalidArgument, "path_required");
        };
        let root = match Path::new(folder).canonicalize() {
            Ok(root) => root,
            Err(_) => return refused(ErrorCode::TargetUnavailable, "file_unavailable"),
        };
        match root.join(path).canonicalize() {
            Ok(full) if full.starts_with(&root) => full,
            Ok(_) => return refused(ErrorCode::InvalidArgument, "path_outside_folder"),
            Err(_) => return refused(ErrorCode::TargetUnavailable, "file_unavailable"),
        }
    } else if path.is_some() {
        return refused(ErrorCode::InvalidArgument, "path_not_allowed");
    } else {
        PathBuf::from(&known.uri)
    };
    match std::fs::read(source) {
        Ok(bytes) => common::ok_reply(json!({
            "artifact_id": "x", "version": known.version, "raw_bytes": bytes.len(),
            "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
        })),
        Err(_) => refused(ErrorCode::TargetUnavailable, "file_unavailable"),
    }
}

async fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("shellboy-studio-apps-{}", uuid::Uuid::new_v4()));
    let apps = root.join("anywhere");
    let registry: Registry = Arc::new(Mutex::new(BTreeMap::new()));
    let known = registry.clone();
    let read_fault: Arc<Mutex<Option<ErrorCode>>> = Arc::new(Mutex::new(None));
    let fault = read_fault.clone();
    let (owner, _events) = mock_replies(move |command| match command {
        Command::MessageSend(_) => common::ok_reply(json!({"message_id": "m1"})),
        Command::ThreadGet(_) => common::ok_reply(json!({"thread_id": "t1", "title": "T"})),
        Command::HistoryList(_) => common::ok_reply(json!({"items": []})),
        Command::ThreadList(_) => common::ok_reply(json!({"items": [{"thread_id": "t1"}]})),
        Command::ArtifactGet(args) => match known.lock().unwrap().get(&args.artifact_id) {
            Some(found) => common::ok_reply(summary(&args.artifact_id, found)),
            None => refused(ErrorCode::TargetUnavailable, "no such artifact"),
        },
        Command::ArtifactList(args) => {
            let all: Vec<Value> = known
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, found)| args.thread_id.as_deref() == Some(found.thread.as_str()))
                .map(|(id, found)| summary(id, found))
                .collect();
            let from: usize = args.cursor.as_deref().map_or(0, |c| c.parse().unwrap());
            let page: Vec<Value> = all
                .iter()
                .skip(from)
                .take(args.limit as usize)
                .cloned()
                .collect();
            let end = from + page.len();
            let mut reply = json!({"items": page, "limit": args.limit});
            if end < all.len() {
                reply["next_cursor"] = json!(end.to_string());
            }
            common::ok_reply(reply)
        }
        Command::ArtifactRead(_) if fault.lock().unwrap().is_some() => {
            let code = fault.lock().unwrap().unwrap();
            refused(code, "refused")
        }
        Command::ArtifactRead(args) => match known.lock().unwrap().get(&args.artifact_id) {
            Some(found) if found.version == args.version && found.thread == args.thread_id => {
                read_artifact(found, args.path.as_deref())
            }
            _ => refused(ErrorCode::TargetUnavailable, "no such version"),
        },
        _ => common::ok_reply(json!({})),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let cancel = CancellationToken::new();
    let state = Shared::with_cancel(
        owner.clone(),
        Hub::new(),
        Auth::new("ab".repeat(32)),
        ServerConfig {
            listen: addr,
            extra_hosts: vec![],
            data_dir: "/temp/data".into(),
            config_dir: "/temp/config".into(),
            core_config_path: "/temp/config/config.toml".into(),
            debug: false,
        },
        cancel.clone(),
    );
    std::mem::forget(_events);
    tokio::spawn(serve(listener, state.clone(), fast_poll(), cancel.clone()));
    Fixture {
        root,
        apps,
        registry,
        read_fault,
        addr,
        state,
        owner,
        cancel,
    }
}

/// An opened app's file URL, as a path.
async fn open(f: &Fixture, name: &str) -> String {
    let out = f.state.apps.open(name).await.unwrap();
    let url = out["url"].as_str().unwrap().to_owned();
    assert!(
        url.starts_with("/a/"),
        "a path, so any host or tunnel carries it: {url}"
    );
    url
}

/// What the parent frame does for a page: names the app and forwards the call.
async fn call(f: &Fixture, name: &str, op: &str, args: Value) -> Value {
    f.state.apps.call(name, op, args).await
}

#[tokio::test]
async fn instance_wait_ignores_other_instance_changes() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    let apps = f.state.apps.clone();
    let initial = apps
        .call_instance("one", "data.wait", json!({}), Some("alpha"))
        .await;
    let version = initial["result"]["version"].as_u64().unwrap();
    let wait_app = apps.clone();
    let mut wait = tokio::spawn(async move {
        wait_app
            .call_instance(
                "one",
                "data.wait",
                json!({"version": version}),
                Some("alpha"),
            )
            .await
    });
    let all = apps.call("one", "data.wait", json!({})).await["result"]["version"].clone();
    let dir = f.apps.join("one/data/beta");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("x"), "other").unwrap();
    // The app-wide wait wakes from the same look that would have woken alpha.
    let seen = apps.call("one", "data.wait", json!({"version": all})).await;
    assert_eq!(seen["result"]["changed"], true, "{seen}");
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(300), &mut wait)
            .await
            .is_err()
    );
    let dir = f.apps.join("one/data/alpha");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("x"), "own").unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(4), wait)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result["result"]["changed"], true);
}

#[tokio::test]
async fn instance_registry_is_bounded_validated_and_survives_host_recreation() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    let apps = &f.state.apps;
    assert!(apps.add_instance("one", "../bad").await.is_err());
    assert!(apps.add_instance("one", "alpha").await.is_ok());
    assert!(apps.add_instance("one", "alpha").await.is_ok());
    assert_eq!(apps.instances("one").await.unwrap(), vec!["alpha"]);
    let other = shellboy_studio::apps::Apps::new(
        f.owner.clone(),
        shellboy_studio::hub::Hub::new(),
        std::sync::Arc::new(tokio::sync::Semaphore::new(8)),
        CancellationToken::new(),
    );
    assert_eq!(other.instances("one").await.unwrap(), vec!["alpha"]);
}

#[tokio::test]
async fn apps_come_from_the_threads_artifacts_and_nothing_else() {
    let f = fixture().await;
    let apps = &f.state.apps;
    assert_eq!(
        apps.list("t1", None).await.unwrap()["apps"],
        json!([]),
        "nothing is bundled"
    );
    assert_eq!(apps.list("", None).await.unwrap_err().0, "invalid_args");
    write_app(&f, "one", "t1", &[PAGE]);
    write_app(&f, "other-thread", "t2", &[PAGE]);
    // Plain artifacts are not apps, whatever their MIME.
    f.register(
        "report",
        "t1",
        "Report",
        "/tmp/report.md".into(),
        Some("text/markdown"),
    );
    f.register(
        "site",
        "t1",
        "Site",
        "https://example.invalid/".into(),
        Some("text/html"),
    );
    f.register(
        "relative",
        "t1",
        "Relative",
        "shellboy-app:not/absolute".into(),
        None,
    );
    let list = apps.list("t1", None).await.unwrap();
    let names: Vec<&str> = list["apps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["one"], "only this Thread's shellboy-app: artifacts");
    assert_eq!(list["apps"][0]["thread"], "t1");
    // A new one shows at once, with no restart and no folder scan.
    write_app(&f, "later", "t1", &[PAGE]);
    assert_eq!(
        apps.list("t1", None).await.unwrap()["apps"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(apps.open("nothing").await.unwrap_err().0, "app_not_found");
    assert_eq!(apps.open("report").await.unwrap_err().0, "not_an_app");
    assert_eq!(apps.open("site").await.unwrap_err().0, "not_an_app");
}

#[tokio::test]
async fn apps_beyond_the_first_owner_page_are_reached_by_its_cursor() {
    let f = fixture().await;
    for n in 0..40 {
        write_app(&f, &format!("app{n:02}"), "t1", &[PAGE]);
    }
    for n in 0..300 {
        f.register(
            &format!("note{n:03}"),
            "t1",
            "Note",
            "/tmp/n.txt".into(),
            None,
        );
    }
    let mut names = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = f.state.apps.list("t1", cursor.as_deref()).await.unwrap();
        names.extend(
            page["apps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a["name"].as_str().unwrap().to_owned()),
        );
        cursor = page["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    names.sort();
    names.dedup();
    assert_eq!(
        names.len(),
        40,
        "every app is reachable, however many artifacts come first"
    );
}

#[tokio::test]
async fn a_new_version_is_shown_by_reopening_and_a_removed_artifact_is_gone() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    open(&f, "one").await;
    // The Thread publishes the same app from another folder: a new version of the artifact.
    let moved = f.apps.join("moved");
    std::fs::create_dir_all(moved.join("data")).unwrap();
    std::fs::write(
        moved.join("index.html"),
        "<html><head></head><body>new folder</body></html>",
    )
    .unwrap();
    f.register(
        "one",
        "t1",
        "One",
        format!("shellboy-app:{}", moved.display()),
        None,
    );
    let web = f.addr.to_string();
    let after = open(&f, "one").await;
    assert!(
        http(&web, "GET", &after, &[], "")
            .await
            .body
            .contains("new folder")
    );
    assert_eq!(
        call(&f, "one", "data.write", json!({"path":"k","text":"v"})).await["ok"],
        true
    );
    assert!(
        moved.join("data/k").exists(),
        "data/ follows the app's current folder"
    );
    f.registry.lock().unwrap().remove("one");
    assert_eq!(
        call(&f, "one", "data.read", json!({"path":"k"})).await["error"]["code"],
        "app_not_found"
    );
    assert_eq!(http(&web, "GET", &after, &[], "").await.status, 404);
}

#[tokio::test]
async fn an_owner_error_is_not_shown_as_a_missing_file() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    let url = open(&f, "one").await;
    let web = f.addr.to_string();
    let entry = url;
    let ok = http(&web, "GET", &entry, &[], "").await;
    assert_eq!(ok.status, 200);
    *f.read_fault.lock().unwrap() = Some(ErrorCode::IoFailed);
    let down = http(&web, "GET", &entry, &[], "").await;
    assert_eq!(down.status, 502);
    assert!(!down.body.contains("missing"), "{}", down.body);
    *f.read_fault.lock().unwrap() = Some(ErrorCode::InvalidArgument);
    let refused = http(&web, "GET", &entry, &[], "").await;
    assert_eq!(refused.status, 404);
    assert!(!refused.body.contains("missing"), "{}", refused.body);
    *f.read_fault.lock().unwrap() = None;
    std::fs::remove_file(f.apps.join("one/index.html")).unwrap();
    let gone = http(&web, "GET", &entry, &[], "").await;
    assert_eq!(gone.status, 404);
    assert!(gone.body.contains("missing"), "{}", gone.body);
}

#[tokio::test]
async fn a_file_html_artifact_is_one_static_page_without_the_api() {
    let f = fixture().await;
    std::fs::create_dir_all(&f.apps).unwrap();
    let page = f.apps.join("report.html");
    std::fs::write(
        &page,
        "<html><head></head><body>static report</body></html>",
    )
    .unwrap();
    std::fs::write(f.apps.join("secret.txt"), "neighbour").unwrap();
    f.register(
        "report",
        "t1",
        "Report",
        page.display().to_string(),
        Some("text/html; charset=utf-8"),
    );
    let apps = &f.state.apps;
    assert_eq!(
        apps.list("t1", None).await.unwrap()["apps"],
        json!([]),
        "Apps lists app folders, not pages"
    );
    let opened = apps.open("report").await.unwrap();
    let url = opened["url"].as_str().unwrap().to_owned();
    let web = f.addr.to_string();
    let reply = http(&web, "GET", &url, &[], "").await;
    assert_eq!(reply.status, 200, "{}", reply.headers);
    assert!(reply.body.contains("static report"));
    assert!(
        !reply.body.contains("api.js"),
        "no app API in a static page"
    );
    let headers = reply.headers.to_ascii_lowercase();
    assert!(
        headers.contains("content-security-policy: sandbox "),
        "{headers}"
    );
    assert!(!headers.contains("allow-same-origin"));
    let base = url.trim_end_matches("index.html");
    for neighbour in ["secret.txt", "../secret.txt", "report.html"] {
        assert_eq!(
            http(&web, "GET", &format!("{base}{neighbour}"), &[], "")
                .await
                .status,
            404,
            "{neighbour}"
        );
    }
    assert_eq!(
        call(&f, "report", "data.read", json!({"path":"k"})).await["error"]["code"],
        "not_an_app",
        "a page has no app API"
    );
}

#[tokio::test]
async fn files_need_the_session_in_their_path_and_are_always_sandboxed() {
    let f = fixture().await;
    write_app(
        &f,
        "one",
        "t1",
        &[
            PAGE,
            ("data/a.txt", "x"),
            ("sub/app.js", "1"),
            ("evil.svg", "<svg onload='alert(1)'/>"),
        ],
    );
    let web = f.addr.to_string();
    let url = open(&f, "one").await;
    let base = url.trim_end_matches("index.html").to_owned();
    assert_eq!(
        http(&web, "GET", "/a/not-a-session/index.html", &[], "")
            .await
            .status,
        404
    );
    // No cookie: an opaque page can't send one.
    let page = http(&web, "GET", &url, &[], "").await;
    assert_eq!(page.status, 200, "{}", page.headers);
    assert!(
        page.headers
            .to_ascii_lowercase()
            .contains("cache-control: no-cache")
    );
    assert!(page.body.contains("hello"));
    std::fs::write(
        f.apps.join("one/index.html"),
        "<html><head></head><body>updated</body></html>",
    )
    .unwrap();
    let refreshed = http(&web, "GET", &url, &[], "").await;
    assert!(refreshed.body.contains("updated"));
    let reopened = open(&f, "one").await;
    let reopened_base = reopened.trim_end_matches("index.html");
    assert_eq!(
        http(&web, "GET", &format!("{reopened_base}data/a.txt"), &[], "")
            .await
            .body,
        "x"
    );
    assert!(
        refreshed
            .headers
            .to_ascii_lowercase()
            .contains("cache-control: no-cache")
    );
    assert!(
        page.body
            .contains("<head><script src=\"/_shellboy/api.js\"></script><title>"),
        "{}",
        page.body
    );
    for (path, status) in [
        ("sub/app.js", 200),
        ("data/a.txt", 200),
        ("evil.svg", 200),
        ("gone.js", 404),
    ] {
        let reply = http(&web, "GET", &format!("{base}{path}"), &[], "").await;
        assert_eq!(reply.status, status, "{path}");
        // Opened on its own at the Web UI's origin, a file must not be same-origin with it.
        let headers = reply.headers.to_ascii_lowercase();
        assert!(
            headers.contains("cache-control: no-cache"),
            "{path}: {headers}"
        );
        assert!(
            headers.contains("content-security-policy: sandbox "),
            "{path}: {headers}"
        );
        assert!(!headers.contains("allow-same-origin"), "{path}");
        assert!(
            headers.contains("x-content-type-options: nosniff"),
            "{path}"
        );
        assert!(headers.contains("access-control-allow-origin: *"), "{path}");
        assert!(headers.contains("referrer-policy: no-referrer"), "{path}");
    }
    assert_eq!(
        http(&web, "GET", &format!("{base}sub/app.js"), &[], "")
            .await
            .body,
        "1"
    );
    for sneaky in [
        "../one/index.html",
        "%2e%2e/one/index.html",
        "..%2fone%2findex.html",
        "sub/../../x",
    ] {
        assert_ne!(
            http(&web, "GET", &format!("{base}{sneaky}"), &[], "")
                .await
                .status,
            200,
            "{sneaky}"
        );
    }
    assert_eq!(http(&web, "POST", &url, &[], "").await.status, 405);
    assert!(
        http(&web, "GET", "/_shellboy/api.js", &[], "")
            .await
            .body
            .contains("shellboy")
    );
    assert!(
        http(&web, "GET", "/_shellboy/ui.css", &[], "")
            .await
            .body
            .contains("--bg")
    );
    assert_eq!(
        raw(
            &web,
            format!("GET {url} HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n")
        )
        .await,
        403,
        "DNS rebinding"
    );
}

#[tokio::test]
async fn an_app_page_cant_reach_the_web_ui() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    write_app(&f, "two", "t1", &[PAGE]);
    let web = f.addr.to_string();
    // A sandboxed page's requests carry `Origin: null`.
    let session = login(f.addr, &f.state).await;
    let upgrade = |origin: &str, cookie: &str| {
        format!(
            "GET /ws HTTP/1.1\r\nHost: {web}\r\nOrigin: {origin}\r\nCookie: {cookie}\r\nUpgrade: websocket\r\nConnection: upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
        )
    };
    assert_eq!(
        raw(&web, upgrade(&format!("http://{web}"), &session)).await,
        101,
        "the Web UI itself"
    );
    assert_eq!(raw(&web, upgrade("null", &session)).await, 403);
    assert_eq!(raw(&web, upgrade("null", "")).await, 403);
    let auth = json!({"token": f.state.auth.token()}).to_string();
    assert_eq!(
        http(
            &web,
            "POST",
            "/auth",
            &[("Origin", "null"), ("Content-Type", "application/json")],
            &auth
        )
        .await
        .status,
        403
    );
    // The token is on no route a page can read, and the app API exists only over `/ws`.
    let token = "ab".repeat(32);
    for path in [
        "/_shellboy/api.js",
        "/_shellboy/ui.css",
        &open(&f, "one").await,
    ] {
        assert!(
            !http(&web, "GET", path, &[], "").await.body.contains(&token),
            "{path}"
        );
    }
    assert_eq!(
        http(&web, "POST", "/_shellboy/call", &[("Origin", "null")], "{}")
            .await
            .status,
        404,
        "no such route for a page to call"
    );
    // Each page's data is its own: the app comes from who forwarded it, and a path can't leave.
    assert_eq!(
        call(&f, "one", "data.write", json!({"path":"k","text":"one"})).await["ok"],
        true
    );
    assert_eq!(
        call(&f, "two", "data.read", json!({"path":"k"})).await["result"]["exists"],
        false
    );
    assert_eq!(
        call(&f, "two", "data.read", json!({"path":"../../one/data/k"})).await["error"]["code"],
        "invalid_path"
    );
    assert_eq!(
        call(&f, "nothing", "data.read", json!({"path":"k"})).await["error"]["code"],
        "app_not_found"
    );
}

#[tokio::test]
async fn the_api_runs_over_the_web_uis_socket() {
    let f = fixture().await;
    write_app(&f, "one", "bound", &[PAGE]);
    let cookie = login(f.addr, &f.state).await;
    let mut request = format!("ws://{}/ws", f.addr).into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", format!("http://{}", f.addr).parse().unwrap());
    request
        .headers_mut()
        .insert("cookie", cookie.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    async fn result(
        ws: &mut (
                 impl futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
                 + Unpin
             ),
        id: u64,
    ) -> Value {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(10), ws.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            if let Message::Text(text) = message {
                let v: Value = serde_json::from_str(text.as_str()).unwrap();
                if v["t"] == "result" && v["id"] == id {
                    return v["response"]["result"].clone();
                }
            }
        }
    }
    let send = |id: u64, command: &str, args: Value| {
        Message::Text(
            json!({"t":"call","id":id,"command":command,"args":args})
                .to_string()
                .into(),
        )
    };
    ws.send(send(1, "apps.list", json!({"thread":"bound"})))
        .await
        .unwrap();
    assert_eq!(result(&mut ws, 1).await["apps"][0]["title"], "one");
    ws.send(send(2, "apps.open", json!({"name":"one"})))
        .await
        .unwrap();
    assert!(
        result(&mut ws, 2).await["url"]
            .as_str()
            .unwrap()
            .starts_with("/a/")
    );
    ws.send(send(
        3,
        "apps.call",
        json!({"name":"one","op":"app.info","args":{}}),
    ))
    .await
    .unwrap();
    assert_eq!(result(&mut ws, 3).await["result"]["thread"], "bound");
    // A write past the old 1 MiB frame, as an app's data.write can be.
    let large = "x".repeat(4 * 1024 * 1024);
    ws.send(send(
        4,
        "apps.call",
        json!({"name":"one","op":"data.write","args":{"path":"big.txt","text":large}}),
    ))
    .await
    .unwrap();
    assert_eq!(result(&mut ws, 4).await["ok"], true);
    assert_eq!(
        std::fs::metadata(f.apps.join("one/data/big.txt"))
            .unwrap()
            .len(),
        4 * 1024 * 1024
    );
    // A wait holds no ordinary slot, and cancelling it ends it.
    for id in 10..16u64 {
        ws.send(send(
            id,
            "apps.call",
            json!({"name":"one","op":"data.wait","args":{"version":0}}),
        ))
        .await
        .unwrap();
    }
    ws.send(send(5, "apps.list", json!({"thread":"bound"})))
        .await
        .unwrap();
    assert_eq!(result(&mut ws, 5).await["apps"][0]["name"], "one");
    for id in 10..16u64 {
        ws.send(Message::Text(
            json!({"t":"cancel","id":id}).to_string().into(),
        ))
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn data_detects_concurrent_writes_and_stays_inside() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    assert_eq!(
        call(&f, "one", "data.read", json!({"path":"a/b.json"})).await["result"],
        json!({"exists":false,"text":null,"hash":null})
    );
    let first = call(
        &f,
        "one",
        "data.write",
        json!({"path":"a/b.json","text":"[1]","hash":null,"check":true}),
    )
    .await;
    let hash = first["result"]["hash"].as_str().unwrap().to_owned();
    assert_eq!(
        std::fs::read_to_string(f.apps.join("one/data/a/b.json")).unwrap(),
        "[1]",
        "shared with the Thread"
    );
    let read = call(&f, "one", "data.read", json!({"path":"a/b.json"})).await;
    assert_eq!(read["result"]["text"], "[1]");
    assert_eq!(read["result"]["hash"], hash.as_str());
    // A write from the Thread, between the page's read and its write.
    std::fs::write(f.apps.join("one/data/a/b.json"), "[2]").unwrap();
    let stale = call(
        &f,
        "one",
        "data.write",
        json!({"path":"a/b.json","text":"[3]","hash":hash,"check":true}),
    )
    .await;
    assert_eq!(stale["error"]["code"], "conflict");
    assert_eq!(
        std::fs::read_to_string(f.apps.join("one/data/a/b.json")).unwrap(),
        "[2]"
    );
    assert_eq!(
        call(
            &f,
            "one",
            "data.write",
            json!({"path":"a/b.json","text":"[1]","hash":null,"check":true})
        )
        .await["error"]["code"],
        "conflict"
    );
    assert_eq!(
        call(
            &f,
            "one",
            "data.write",
            json!({"path":"a/b.json","text":"[4]"})
        )
        .await["ok"],
        true,
        "without a hash it overwrites"
    );
    for bad in ["../app.json", "/etc/passwd", "a/../../x", "..\\x", ""] {
        assert_eq!(
            call(&f, "one", "data.write", json!({"path":bad,"text":"x"})).await["error"]["code"],
            "invalid_path",
            "{bad}"
        );
        assert_eq!(
            call(&f, "one", "data.read", json!({"path":bad})).await["error"]["code"],
            "invalid_path",
            "{bad}"
        );
    }
    let listed = call(&f, "one", "data.list", json!({})).await;
    assert_eq!(listed["result"]["entries"][0]["name"], "a");
    assert_eq!(listed["result"]["entries"][0]["dir"], true);
    assert_eq!(
        std::fs::read_dir(f.apps.join("one/data/a"))
            .unwrap()
            .count(),
        1,
        "no temp file left"
    );
    #[cfg(unix)]
    {
        std::fs::write(f.root.join("outside.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(f.root.join("outside.txt"), f.apps.join("one/data/link"))
            .unwrap();
        std::os::unix::fs::symlink(&f.root, f.apps.join("one/data/out")).unwrap();
        assert_eq!(
            call(&f, "one", "data.read", json!({"path":"link"})).await["result"]["exists"],
            false
        );
        assert_eq!(
            call(&f, "one", "data.write", json!({"path":"out/x","text":"x"})).await["error"]["code"],
            "invalid_path"
        );
        assert!(!f.root.join("x").exists());
        assert_eq!(
            http(
                &f.addr.to_string(),
                "GET",
                &open(&f, "one").await.replace("index.html", "data/link"),
                &[],
                ""
            )
            .await
            .status,
            404
        );
    }
}

#[tokio::test]
async fn messages_are_recorded_as_from_the_app_not_a_person() {
    let f = fixture().await;
    write_app(&f, "one", "bound", &[PAGE]);
    assert_eq!(
        call(&f, "one", "app.info", json!({})).await["result"]["thread"],
        "bound"
    );
    assert_eq!(
        call(&f, "one", "thread.send", json!({"text":"hi"})).await["ok"],
        true
    );
    call(
        &f,
        "one",
        "thread.send",
        json!({"text":"there","thread":"other"}),
    )
    .await;
    let sends: Vec<_> = f
        .owner
        .other_calls
        .lock()
        .unwrap()
        .iter()
        .filter_map(|c| {
            if let Command::MessageSend(s) = c {
                Some(s.clone())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(sends.len(), 2);
    assert!(!sends[0].human);
    assert_eq!(sends[0].sender_label.as_deref(), Some("app:one"));
    assert_eq!(sends[0].thread_id.as_deref(), Some("bound"));
    assert_eq!(sends[1].thread_id.as_deref(), Some("other"));
    assert_eq!(
        call(&f, "one", "thread.messages", json!({"limit":5000})).await["ok"],
        true
    );
    assert!(
        f.owner
            .other_calls
            .lock()
            .unwrap()
            .iter()
            .any(|c| matches!(c, Command::HistoryList(a) if a.limit == 200)),
        "limit is capped"
    );
    assert_eq!(
        call(&f, "one", "threads.list", json!({})).await["result"]["items"][0]["thread_id"],
        "t1"
    );
    assert_eq!(
        call(&f, "one", "nope", json!({})).await["error"]["code"],
        "unknown_call"
    );
    assert_eq!(
        call(
            &f,
            "one",
            "data.write",
            json!({"path":"k","text":"still works"})
        )
        .await["ok"],
        true
    );
}

#[tokio::test]
async fn on_change_uses_the_shared_hints() {
    let f = fixture().await;
    write_app(&f, "one", "bound", &[PAGE]);
    let apps = f.state.apps.clone();
    let waiting = tokio::spawn(async move { apps.call("one", "events.wait", json!({})).await });
    let hub = f.state.hub.clone();
    let before = hub.session_count();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(hub.session_count() > before || before > 0);
    hub.hint(["elsewhere"]);
    hub.hint(["bound"]);
    let out = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out["result"]["changed"], true);
    assert_eq!(out["result"]["threads"], json!(["bound"]));
    let count = f.owner.event_args.lock().unwrap().len();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        f.owner.event_args.lock().unwrap().len() <= count + 1,
        "no extra long-poll per app"
    );
}

#[tokio::test]
async fn hosts_are_bounded_and_unused_ones_make_room() {
    let f = fixture().await;
    let max = shellboy_studio::apps::catalog::MAX_APPS;
    for n in 0..max {
        write_app(&f, &format!("app{n}"), "t1", &[PAGE]);
        assert_eq!(
            call(&f, &format!("app{n}"), "app.info", json!({})).await["ok"],
            true
        );
    }
    // None of them is in use, so a new one takes a slot instead of being refused.
    write_app(&f, "late", "t1", &[PAGE]);
    assert_eq!(call(&f, "late", "app.info", json!({})).await["ok"], true);
}

#[tokio::test]
async fn watchers_stop_with_the_bridge() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    assert_eq!(call(&f, "one", "data.wait", json!({})).await["ok"], true);
    f.cancel.cancel();
    tokio::time::timeout(Duration::from_secs(5), f.state.apps.stopped())
        .await
        .expect("the watcher ends with the bridge");
}

#[tokio::test]
async fn data_changes_from_outside_reach_the_page_through_one_watcher() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE, ("data/start.txt", "x")]);
    let first = call(&f, "one", "data.wait", json!({})).await;
    let mut version = first["result"]["version"].clone();
    assert_eq!(
        first["result"]["changed"], false,
        "the first call only learns where things stand"
    );
    // A Thread's shell writing, not the API. One sample each, on loopback: a record, not a bound.
    let mut samples = Vec::new();
    for (n, file) in ["a.json", "sub/b.json", "a.json"].iter().enumerate() {
        let (apps, v) = (f.state.apps.clone(), version.clone());
        let waiting =
            tokio::spawn(async move { apps.call("one", "data.wait", json!({"version": v})).await });
        tokio::time::sleep(Duration::from_millis(40)).await;
        let path = f.apps.join("one/data").join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let started = std::time::Instant::now();
        std::fs::write(&path, format!("{n}")).unwrap();
        let out = tokio::time::timeout(Duration::from_secs(5), waiting)
            .await
            .unwrap()
            .unwrap();
        samples.push(started.elapsed());
        assert_eq!(out["result"]["changed"], true, "{out}");
        assert!(
            out["result"]["paths"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == file),
            "{out}"
        );
        version = out["result"]["version"].clone();
    }
    eprintln!(
        "observed: file written to page told after {samples:?} (three samples, debug build, not a bound)"
    );
    // A change between two waits isn't lost.
    std::fs::remove_file(f.apps.join("one/data/a.json")).unwrap();
    tokio::time::sleep(Duration::from_millis(600)).await;
    let out = call(&f, "one", "data.wait", json!({"version": version})).await;
    assert_eq!(out["result"]["changed"], true, "{out}");
    assert!(
        out["result"]["paths"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "a.json"),
        "{out}"
    );
}

/// A stand-in for an app's backend service: listens on 127.0.0.1, answers JSON when the request carries
/// `token` and 401 otherwise, and records every request it saw.
async fn fake_backend(token: &str) -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let want = format!("Bearer {token}");
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let mut raw = Vec::new();
            let mut chunk = [0u8; 4096];
            let (head, body) = loop {
                let n = stream.read(&mut chunk).await.unwrap_or(0);
                raw.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&raw).into_owned();
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if body.len() >= length || n == 0 {
                        break (head.to_owned(), body.to_owned());
                    }
                } else if n == 0 {
                    break (text, String::new());
                }
            };
            log.lock().unwrap().push(format!("{head}\r\n\r\n{body}"));
            let allowed = head
                .lines()
                .any(|l| l.eq_ignore_ascii_case(&format!("authorization: {want}")));
            let reply = if allowed {
                let out = json!({"got": body}).to_string();
                format!(
                    "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{out}",
                    out.len()
                )
            } else {
                "HTTP/1.0 401 Unauthorized\r\nContent-Length: 0\r\n\r\n".to_owned()
            };
            let _ = stream.write_all(reply.as_bytes()).await;
        }
    });
    (port, seen)
}

fn write_endpoint(f: &Fixture, app: &str, port: u16, token: &str) {
    std::fs::write(
        f.apps.join(app).join(".app.endpoint"),
        json!({"port": port, "token": token}).to_string(),
    )
    .unwrap();
}

/// One call as the Web UI's socket carries it: `apps.call` over `/ws`.
async fn ws_app_call(f: &Fixture, name: &str, op: &str, args: Value) -> Value {
    let cookie = login(f.addr, &f.state).await;
    let mut request = format!("ws://{}/ws", f.addr).into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", format!("http://{}", f.addr).parse().unwrap());
    request
        .headers_mut()
        .insert("cookie", cookie.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    ws.send(Message::Text(
        json!({"t":"call","id":1,"command":"apps.call","args":{"name":name,"op":op,"args":args}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    loop {
        let message = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(text) = message {
            let v: Value = serde_json::from_str(text.as_str()).unwrap();
            if v["t"] == "result" && v["id"] == 1 {
                return v["response"]["result"].clone();
            }
        }
    }
}

#[tokio::test]
async fn call_reaches_only_the_apps_own_backend_with_its_token() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    write_app(&f, "two", "t1", &[PAGE]);
    let (port_one, seen_one) = fake_backend("token-one").await;
    let (port_two, seen_two) = fake_backend("token-two").await;
    write_endpoint(&f, "one", port_one, "token-one");
    write_endpoint(&f, "two", port_two, "token-two");
    let out = ws_app_call(
        &f,
        "one",
        "call",
        json!({"path":"/api/board","body":{"move":"card-1"}}),
    )
    .await;
    assert_eq!(out["ok"], true, "{out}");
    assert_eq!(out["result"]["status"], 200);
    let echoed: Value =
        serde_json::from_str(out["result"]["body"]["got"].as_str().unwrap()).unwrap();
    assert_eq!(echoed, json!({"move":"card-1"}));
    let seen = seen_one.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].starts_with("POST /api/board "), "{}", seen[0]);
    assert!(
        seen_two.lock().unwrap().is_empty(),
        "another app's backend is never reached"
    );
    // A path that is not a path on the backend is refused before anything is sent.
    for bad in ["//elsewhere/x", "api", "/a b", "/x#y"] {
        let out = ws_app_call(&f, "one", "call", json!({"path": bad})).await;
        assert_eq!(out["error"]["code"], "invalid_path", "{bad}: {out}");
    }
    assert_eq!(seen_one.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn call_gives_typed_errors_when_the_backend_is_missing_down_or_refuses() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    let code = |out: Value| out["error"]["code"].as_str().unwrap_or("").to_owned();
    // No endpoint file: the service is not running.
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(code(out), "no_backend");
    // A file that is not an endpoint.
    std::fs::write(f.apps.join("one/.app.endpoint"), "not json").unwrap();
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(code(out), "backend_endpoint_unreadable");
    // An endpoint whose service is down: the port was taken and released.
    let (port, _) = fake_backend("t").await;
    let closed = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    assert_ne!(port, closed);
    write_endpoint(&f, "one", closed, "t");
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(code(out), "backend_down");
    // A backend that refuses the token (for instance after a restart with a new one).
    write_endpoint(&f, "one", port, "stale");
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(code(out), "backend_refused");
    // The fresh endpoint works again without anything being restarted here.
    write_endpoint(&f, "one", port, "t");
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(out["ok"], true, "{out}");
}

#[cfg(unix)]
#[tokio::test]
async fn an_endpoint_file_that_leaves_the_folder_is_not_used() {
    let f = fixture().await;
    write_app(&f, "one", "t1", &[PAGE]);
    let (port, seen) = fake_backend("t").await;
    let outside = f.root.join("outside.endpoint");
    std::fs::write(&outside, json!({"port": port, "token": "t"}).to_string()).unwrap();
    std::os::unix::fs::symlink(&outside, f.apps.join("one/.app.endpoint")).unwrap();
    let out = ws_app_call(&f, "one", "call", json!({"path":"/x"})).await;
    assert_eq!(out["error"]["code"], "no_backend", "{out}");
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_page_is_never_served_a_hidden_file() {
    let f = fixture().await;
    write_app(
        &f,
        "one",
        "t1",
        &[
            PAGE,
            (".app.endpoint.tmp", "secret-token"),
            (".hidden/inner.txt", "secret-token"),
            ("sub/ok.txt", "plain"),
        ],
    );
    write_endpoint(&f, "one", 1, "secret-token");
    let base = open(&f, "one")
        .await
        .trim_end_matches("index.html")
        .to_owned();
    let web = f.addr.to_string();
    for path in [
        ".app.endpoint",
        "./.app.endpoint",
        "%2E/.app.endpoint",
        "sub/../.app.endpoint",
        ".APP.ENDPOINT",
        ".app.endpoint.",
        ".app.endpoint.tmp",
        ".hidden/inner.txt",
    ] {
        let reply = http(&web, "GET", &format!("{base}{path}"), &[], "").await;
        assert_eq!(reply.status, 404, "{path}");
        assert!(!reply.body.contains("secret-token"), "{path}");
    }
    let ok = http(&web, "GET", &format!("{base}./sub/ok.txt"), &[], "").await;
    assert_eq!((ok.status, ok.body.as_str()), (200, "plain"));
}
