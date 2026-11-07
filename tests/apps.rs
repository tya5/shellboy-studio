//! The gateway's app hosting over real listeners, with a scripted owner. Every app here is a throwaway
//! written into a temp folder by the test; the product ships none.
mod common;
use common::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use shellboy::protocol::Command;
use shellboy_studio::{
    auth::Auth,
    hub::Hub,
    server::{AppState, AppsPaths, ServerConfig, Shared, serve},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
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

struct Fixture {
    root: PathBuf,
    apps: PathBuf,
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

fn write_app(apps: &Path, name: &str, manifest: &str, files: &[(&str, &str)]) {
    let dir = apps.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("app.json"), manifest).unwrap();
    for (file, text) in files {
        let path = dir.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}

const PAGE: (&str, &str) = (
    "index.html",
    "<!doctype html><html><head><title>t</title></head><body>hello</body></html>",
);

async fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("shellboy-studio-apps-{}", uuid::Uuid::new_v4()));
    let apps = root.join("apps");
    let (owner, _events) = mock(|command| match command {
        Command::MessageSend(_) => Some(json!({"message_id": "m1"})),
        Command::ThreadGet(_) => Some(json!({"thread_id": "t1", "title": "T"})),
        Command::HistoryList(_) => Some(json!({"items": []})),
        Command::ThreadList(_) => Some(json!({"items": [{"thread_id": "t1"}]})),
        _ => Some(json!({})),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let cancel = CancellationToken::new();
    let state = Shared::with_apps(
        owner.clone(),
        Hub::new(),
        Auth::new("ab".repeat(32)),
        ServerConfig {
            listen: addr,
            extra_hosts: vec![],
            data_dir: "/temp/data".into(),
            debug: false,
        },
        Some(AppsPaths { dir: apps.clone() }),
        cancel.clone(),
    );
    std::mem::forget(_events);
    tokio::spawn(serve(listener, state.clone(), fast_poll(), cancel.clone()));
    Fixture {
        root,
        apps,
        addr,
        state,
        owner,
        cancel,
    }
}

/// An opened app's file URL, as a path.
async fn open(f: &Fixture, name: &str) -> String {
    let out = f.state.apps.as_ref().unwrap().open(name).await.unwrap();
    let url = out["url"].as_str().unwrap().to_owned();
    assert!(
        url.starts_with("/a/"),
        "a path, so any host or tunnel carries it: {url}"
    );
    url
}

/// What the parent frame does for a page: names the app and forwards the call.
async fn call(f: &Fixture, name: &str, op: &str, args: Value) -> Value {
    f.state.apps.as_ref().unwrap().call(name, op, args).await
}

#[tokio::test]
async fn finds_apps_without_a_restart_and_writes_only_the_guide() {
    let f = fixture().await;
    let apps = f.state.apps.as_ref().unwrap();
    let guide = std::fs::read_to_string(f.apps.join("README.md")).unwrap();
    assert!(guide.contains("shellboy.data.read"));
    assert!(
        !guide.to_lowercase().contains("todo"),
        "the guide names no product"
    );
    assert_eq!(
        apps.list().await.unwrap()["apps"],
        json!([]),
        "nothing is bundled"
    );
    assert_eq!(
        std::fs::read_dir(&f.apps).unwrap().count(),
        1,
        "only the guide"
    );

    write_app(&f.apps, "one", r#"{"name":"First","thread":"t1"}"#, &[PAGE]);
    write_app(&f.apps, "bad-json", "{nope", &[PAGE]);
    write_app(&f.apps, "no-entry", r#"{"entry":"gone.html"}"#, &[]);
    write_app(&f.apps, "escape", r#"{"entry":"../one/index.html"}"#, &[]);
    std::fs::create_dir_all(f.apps.join("no-manifest")).unwrap();
    std::fs::create_dir_all(f.apps.join("Bad Name")).unwrap();
    let list = apps.list().await.unwrap();
    let names: Vec<&str> = list["apps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["bad-json", "escape", "no-entry", "no-manifest", "one"]
    );
    let of = |n: &str| {
        list["apps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["name"] == n)
            .unwrap()
            .clone()
    };
    assert_eq!(of("one")["title"], "First");
    assert!(of("one")["problem"].is_null());
    assert!(
        of("bad-json")["problem"]
            .as_str()
            .unwrap()
            .contains("app.json")
    );
    assert!(
        of("no-entry")["problem"]
            .as_str()
            .unwrap()
            .contains("gone.html")
    );
    assert!(of("escape")["problem"].as_str().unwrap().contains("inside"));
    assert!(
        of("no-manifest")["problem"]
            .as_str()
            .unwrap()
            .contains("missing")
    );
    let refused = apps.open("bad-json").await.unwrap_err();
    assert_eq!(refused.0, "app_broken");
    assert_eq!(apps.open("nothing").await.unwrap_err().0, "app_not_found");
    assert_eq!(apps.open("../one").await.unwrap_err().0, "app_not_found");
}

#[tokio::test]
async fn files_need_the_session_in_their_path_and_are_always_sandboxed() {
    let f = fixture().await;
    write_app(
        &f.apps,
        "one",
        r#"{"thread":"t1"}"#,
        &[
            PAGE,
            ("actions/secret.sh", "echo hi"),
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
        ("actions/secret.sh", 404),
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
    write_app(&f.apps, "one", "{}", &[PAGE]);
    write_app(&f.apps, "two", "{}", &[PAGE]);
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
    write_app(
        &f.apps,
        "one",
        r#"{"name":"First","thread":"bound"}"#,
        &[PAGE],
    );
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
    ws.send(send(1, "apps.list", json!({}))).await.unwrap();
    assert_eq!(result(&mut ws, 1).await["apps"][0]["title"], "First");
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
    ws.send(send(5, "apps.list", json!({}))).await.unwrap();
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
    write_app(&f.apps, "one", "{}", &[PAGE]);
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
    write_app(&f.apps, "one", r#"{"thread":"bound"}"#, &[PAGE]);
    write_app(&f.apps, "free", "{}", &[PAGE]);
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
        call(&f, "free", "thread.send", json!({"text":"x"})).await["error"]["code"],
        "no_bound_thread"
    );
    assert_eq!(
        call(
            &f,
            "free",
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
    write_app(&f.apps, "one", r#"{"thread":"bound"}"#, &[PAGE]);
    let apps = f.state.apps.clone().unwrap();
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

#[cfg(unix)]
#[tokio::test]
async fn run_has_limits_and_its_source_stays_private() {
    let f = fixture().await;
    write_app(
        &f.apps,
        "one",
        "{}",
        &[
            PAGE,
            (
                "actions/echo.sh",
                "cat; echo \" $SHELLBOY_APP_NAME\"; pwd >&2; exit 3",
            ),
            ("actions/slow.sh", "sleep 30"),
            (
                "actions/big.sh",
                "dd if=/dev/zero bs=1024 count=2048 2>/dev/null | tr '\\0' 'x'",
            ),
            ("actions/twin.sh", "true"),
            ("actions/twin.py", "pass"),
            ("actions/plain.txt", "not executable"),
        ],
    );
    let out = call(&f, "one", "run", json!({"action":"echo","args":{"days":7}})).await;
    let r = &out["result"];
    assert_eq!(r["exit_code"], 3, "{out}");
    assert_eq!(r["stdout"].as_str().unwrap().trim(), "{\"days\":7} one");
    assert!(r["stderr"].as_str().unwrap().contains("/apps/one"));
    assert_eq!(r["timed_out"], false);
    let slow = call(&f, "one", "run", json!({"action":"slow","timeout_ms":200})).await;
    assert_eq!(slow["result"]["timed_out"], true);
    assert!(slow["result"]["duration_ms"].as_u64().unwrap() < 5000);
    let big = call(&f, "one", "run", json!({"action":"big"})).await;
    assert_eq!(big["result"]["stdout_truncated"], true);
    assert_eq!(big["result"]["stdout"].as_str().unwrap().len(), 1024 * 1024);
    assert_eq!(
        call(&f, "one", "run", json!({"action":"twin"})).await["error"]["code"],
        "ambiguous_action"
    );
    assert_eq!(
        call(&f, "one", "run", json!({"action":"twin.sh"})).await["result"]["exit_code"],
        0
    );
    assert_eq!(
        call(&f, "one", "run", json!({"action":"nope"})).await["error"]["code"],
        "no_action"
    );
    for bad in ["../x", "/bin/sh", "a/b", ".hidden", ""] {
        assert_eq!(
            call(&f, "one", "run", json!({"action":bad})).await["error"]["code"],
            "invalid_action",
            "{bad}"
        );
    }
    assert_eq!(
        call(&f, "one", "run", json!({"action":"plain.txt"})).await["error"]["code"],
        "run_failed"
    );
}

#[tokio::test]
async fn watchers_stop_with_the_bridge() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE]);
    assert_eq!(call(&f, "one", "data.wait", json!({})).await["ok"], true);
    f.cancel.cancel();
    tokio::time::timeout(
        Duration::from_secs(5),
        f.state.apps.as_ref().unwrap().stopped(),
    )
    .await
    .expect("the watcher ends with the bridge");
}

#[tokio::test]
async fn data_changes_from_outside_reach_the_page_through_one_watcher() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE, ("data/start.txt", "x")]);
    let first = call(&f, "one", "data.wait", json!({})).await;
    let mut version = first["result"]["version"].clone();
    assert_eq!(
        first["result"]["changed"], false,
        "the first call only learns where things stand"
    );
    // A Thread's shell writing, not the API. One sample each, on loopback: a record, not a bound.
    let mut samples = Vec::new();
    for (n, file) in ["a.json", "sub/b.json", "a.json"].iter().enumerate() {
        let (apps, v) = (f.state.apps.clone().unwrap(), version.clone());
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

#[cfg(unix)]
#[tokio::test]
async fn the_same_action_never_overlaps_and_inherits_the_gateways_environment() {
    let f = fixture().await;
    write_app(
        &f.apps,
        "one",
        "{}",
        &[
            PAGE,
            ("actions/slow.sh", "sleep 1; echo done"),
            ("actions/other.sh", "echo \"$HOME\""),
        ],
    );
    let apps = f.state.apps.clone().unwrap();
    let first =
        tokio::spawn(async move { apps.call("one", "run", json!({"action":"slow"})).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    let second = call(&f, "one", "run", json!({"action":"slow"})).await;
    assert_eq!(second["error"]["code"], "already_running", "{second}");
    // Another action isn't held up.
    let other = call(&f, "one", "run", json!({"action":"other"})).await;
    assert_eq!(
        other["result"]["stdout"].as_str().unwrap().trim(),
        std::env::var("HOME").unwrap_or_default(),
        "credentials come from the gateway's environment the same way"
    );
    assert_eq!(
        first.await.unwrap()["result"]["stdout"]
            .as_str()
            .unwrap()
            .trim(),
        "done"
    );
    assert_eq!(
        call(&f, "one", "run", json!({"action":"slow","timeout_ms":100})).await["result"]["timed_out"],
        true
    );
    assert_eq!(
        call(&f, "one", "run", json!({"action":"slow"})).await["result"]["timed_out"],
        false,
        "finished or timed out, it can run again"
    );
}
