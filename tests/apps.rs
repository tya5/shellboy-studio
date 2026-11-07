//! The gateway's app hosting over real listeners, with a scripted owner. Every app here is a throwaway
//! written into a temp folder by the test; the product ships none.
mod common;
use common::*;
use serde_json::{Value, json};
use shellboy::protocol::Command;
use shellboy_web::{
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
    let root = std::env::temp_dir().join(format!("shellboy-web-apps-{}", uuid::Uuid::new_v4()));
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
            debug: false,
        },
        Some(AppsPaths {
            dir: apps.clone(),
            state_dir: root.join("state"),
        }),
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

/// An opened app: its address, plus the session cookie a browser would hold.
async fn open(f: &Fixture, name: &str) -> (String, String) {
    let out = f
        .state
        .apps
        .as_ref()
        .unwrap()
        .open(name, &f.addr.to_string())
        .await
        .unwrap();
    let origin = out["origin"].as_str().unwrap();
    assert!(origin.starts_with("http://127.0.0.1:"), "{origin}");
    let addr = origin.trim_start_matches("http://").to_owned();
    let url = out["url"].as_str().unwrap();
    let path = &url[origin.len()..];
    let reply = http(&addr, "GET", path, &[], "").await;
    assert_eq!(reply.status, 303, "{}", reply.headers);
    assert!(reply.headers.contains("HttpOnly"));
    assert!(reply.headers.contains("SameSite=Strict"));
    let cookie = reply
        .headers
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
        .unwrap()
        .split_once(':')
        .unwrap()
        .1
        .trim()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    (addr, cookie)
}

async fn call(addr: &str, cookie: &str, op: &str, args: Value) -> Value {
    let origin = format!("http://{addr}");
    let reply = http(
        addr,
        "POST",
        "/_shellboy/call",
        &[
            ("Origin", &origin),
            ("Cookie", cookie),
            ("Content-Type", "application/json"),
        ],
        &json!({"op": op, "args": args}).to_string(),
    )
    .await;
    assert_eq!(reply.status, 200, "{op}: {} {}", reply.headers, reply.body);
    serde_json::from_str(&reply.body).unwrap()
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
    let refused = apps.open("bad-json", "127.0.0.1:1").await.unwrap_err();
    assert_eq!(refused.0, "app_broken");
    assert_eq!(
        apps.open("nothing", "127.0.0.1:1").await.unwrap_err().0,
        "app_not_found"
    );
    assert_eq!(
        apps.open("../one", "127.0.0.1:1").await.unwrap_err().0,
        "app_not_found"
    );
}

#[tokio::test]
async fn a_ticket_works_once_and_nothing_is_served_without_a_session() {
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
        ],
    );
    let out = f
        .state
        .apps
        .as_ref()
        .unwrap()
        .open("one", &f.addr.to_string())
        .await
        .unwrap();
    let origin = out["origin"].as_str().unwrap();
    let addr = origin.trim_start_matches("http://").to_owned();
    assert_ne!(addr, f.addr.to_string(), "an app has its own origin");
    let no = http(&addr, "GET", "/", &[], "").await;
    assert_eq!(no.status, 401);
    assert!(!no.body.contains("hello"));
    let path = &out["url"].as_str().unwrap()[origin.len()..];
    assert_eq!(http(&addr, "GET", path, &[], "").await.status, 303);
    assert_eq!(
        http(&addr, "GET", path, &[], "").await.status,
        401,
        "a ticket works once"
    );
    let (addr, cookie) = open(&f, "one").await;
    let page = http(&addr, "GET", "/", &[("Cookie", &cookie)], "").await;
    assert_eq!(page.status, 200);
    assert!(page.body.contains("hello"));
    assert!(
        page.body
            .contains("<head><script src=\"/_shellboy/api.js\"></script><title>"),
        "{}",
        page.body
    );
    assert!(
        page.headers
            .contains(&format!("frame-ancestors http://{}", f.addr)),
        "{}",
        page.headers
    );
    assert_eq!(
        http(&addr, "GET", "/sub/app.js", &[("Cookie", &cookie)], "")
            .await
            .body,
        "1"
    );
    assert_eq!(
        http(&addr, "GET", "/data/a.txt", &[("Cookie", &cookie)], "")
            .await
            .status,
        200
    );
    assert_eq!(
        http(
            &addr,
            "GET",
            "/actions/secret.sh",
            &[("Cookie", &cookie)],
            ""
        )
        .await
        .status,
        404
    );
    assert_eq!(
        http(
            &addr,
            "GET",
            "/../one/index.html",
            &[("Cookie", &cookie)],
            ""
        )
        .await
        .status,
        404
    );
    assert_eq!(
        http(
            &addr,
            "GET",
            "/%2e%2e/one/index.html",
            &[("Cookie", &cookie)],
            ""
        )
        .await
        .status,
        404
    );
    assert!(
        http(&addr, "GET", "/_shellboy/api.js", &[], "")
            .await
            .body
            .contains("shellboy")
    );
    assert_eq!(
        raw(&addr, format!("GET / HTTP/1.1\r\nHost: evil.example\r\nCookie: {cookie}\r\nConnection: close\r\n\r\n")).await,
        403,
        "DNS rebinding"
    );
}

#[tokio::test]
async fn origins_are_kept_apart() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE]);
    write_app(&f.apps, "two", "{}", &[PAGE]);
    let (one, one_cookie) = open(&f, "one").await;
    let (two, two_cookie) = open(&f, "two").await;
    assert_ne!(one, two);
    let body = json!({"op":"app.info","args":{}}).to_string();
    let call_from = |origin: String, cookie: String, target: String, body: String| async move {
        http(
            &target,
            "POST",
            "/_shellboy/call",
            &[("Origin", &origin), ("Cookie", &cookie)],
            &body,
        )
        .await
        .status
    };
    assert_eq!(
        call_from(
            format!("http://{one}"),
            one_cookie.clone(),
            one.clone(),
            body.clone()
        )
        .await,
        200
    );
    // Another app's page, or any other site.
    assert_eq!(
        call_from(
            format!("http://{two}"),
            one_cookie.clone(),
            one.clone(),
            body.clone()
        )
        .await,
        403
    );
    assert_eq!(
        call_from(
            "https://evil.example".into(),
            one_cookie.clone(),
            one.clone(),
            body.clone()
        )
        .await,
        403
    );
    // A session for one app is no session for another. A browser would send both: cookies ignore ports.
    assert_eq!(
        call_from(
            format!("http://{two}"),
            one_cookie.clone(),
            two.clone(),
            body.clone()
        )
        .await,
        401
    );
    assert_eq!(
        call_from(
            format!("http://{two}"),
            two_cookie.clone(),
            two.clone(),
            body.clone()
        )
        .await,
        200
    );

    // The Web UI: a browser would attach its session cookie to an app's request, because cookies ignore
    // ports. The Origin check is what stops an app's page, so it's tested with a valid cookie.
    let session = login(f.addr, &f.state).await;
    let web = f.addr.to_string();
    let app_origin = format!("http://{one}");
    let upgrade = |origin: &str| {
        format!(
            "GET /ws HTTP/1.1\r\nHost: {web}\r\nOrigin: {origin}\r\nCookie: {session}\r\nUpgrade: websocket\r\nConnection: upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
        )
    };
    assert_eq!(
        raw(&web, upgrade(&format!("http://{web}"))).await,
        101,
        "the Web UI's own origin"
    );
    assert_eq!(raw(&web, upgrade(&app_origin)).await, 403);
    let auth = json!({"token": f.state.auth.token()}).to_string();
    assert_eq!(
        http(
            &web,
            "POST",
            "/auth",
            &[
                ("Origin", &app_origin),
                ("Content-Type", "application/json")
            ],
            &auth
        )
        .await
        .status,
        403
    );
    // An app's own files and API never carry the Web UI's token.
    assert!(
        !http(&one, "GET", "/_shellboy/api.js", &[], "")
            .await
            .body
            .contains(&"ab".repeat(32))
    );
}

#[tokio::test]
async fn data_detects_concurrent_writes_and_stays_inside() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE]);
    let (addr, cookie) = open(&f, "one").await;
    assert_eq!(
        call(&addr, &cookie, "data.read", json!({"path":"a/b.json"})).await["result"],
        json!({"exists":false,"text":null,"hash":null})
    );
    let first = call(
        &addr,
        &cookie,
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
    let read = call(&addr, &cookie, "data.read", json!({"path":"a/b.json"})).await;
    assert_eq!(read["result"]["text"], "[1]");
    assert_eq!(read["result"]["hash"], hash.as_str());
    // A write from the Thread, between the page's read and its write.
    std::fs::write(f.apps.join("one/data/a/b.json"), "[2]").unwrap();
    let stale = call(
        &addr,
        &cookie,
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
            &addr,
            &cookie,
            "data.write",
            json!({"path":"a/b.json","text":"[1]","hash":null,"check":true})
        )
        .await["error"]["code"],
        "conflict"
    );
    assert_eq!(
        call(
            &addr,
            &cookie,
            "data.write",
            json!({"path":"a/b.json","text":"[4]"})
        )
        .await["ok"],
        true,
        "without a hash it overwrites"
    );
    for bad in ["../app.json", "/etc/passwd", "a/../../x", "..\\x", ""] {
        assert_eq!(
            call(&addr, &cookie, "data.write", json!({"path":bad,"text":"x"})).await["error"]["code"],
            "invalid_path",
            "{bad}"
        );
        assert_eq!(
            call(&addr, &cookie, "data.read", json!({"path":bad})).await["error"]["code"],
            "invalid_path",
            "{bad}"
        );
    }
    let listed = call(&addr, &cookie, "data.list", json!({})).await;
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
            call(&addr, &cookie, "data.read", json!({"path":"link"})).await["result"]["exists"],
            false
        );
        assert_eq!(
            call(
                &addr,
                &cookie,
                "data.write",
                json!({"path":"out/x","text":"x"})
            )
            .await["error"]["code"],
            "invalid_path"
        );
        assert!(!f.root.join("x").exists());
        assert_eq!(
            http(&addr, "GET", "/data/link", &[("Cookie", &cookie)], "")
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
    let (addr, cookie) = open(&f, "one").await;
    assert_eq!(
        call(&addr, &cookie, "app.info", json!({})).await["result"]["thread"],
        "bound"
    );
    assert_eq!(
        call(&addr, &cookie, "thread.send", json!({"text":"hi"})).await["ok"],
        true
    );
    call(
        &addr,
        &cookie,
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
        call(&addr, &cookie, "thread.messages", json!({"limit":5000})).await["ok"],
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
        call(&addr, &cookie, "threads.list", json!({})).await["result"]["items"][0]["thread_id"],
        "t1"
    );
    assert_eq!(
        call(&addr, &cookie, "nope", json!({})).await["error"]["code"],
        "unknown_call"
    );
    let (free, free_cookie) = open(&f, "free").await;
    assert_eq!(
        call(&free, &free_cookie, "thread.send", json!({"text":"x"})).await["error"]["code"],
        "no_bound_thread"
    );
    assert_eq!(
        call(
            &free,
            &free_cookie,
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
    let (addr, cookie) = open(&f, "one").await;
    let (a, c) = (addr.clone(), cookie.clone());
    let waiting = tokio::spawn(async move { call(&a, &c, "events.wait", json!({})).await });
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
    let (addr, cookie) = open(&f, "one").await;
    let out = call(
        &addr,
        &cookie,
        "run",
        json!({"action":"echo","args":{"days":7}}),
    )
    .await;
    let r = &out["result"];
    assert_eq!(r["exit_code"], 3, "{out}");
    assert_eq!(r["stdout"].as_str().unwrap().trim(), "{\"days\":7} one");
    assert!(r["stderr"].as_str().unwrap().contains("/apps/one"));
    assert_eq!(r["timed_out"], false);
    let slow = call(
        &addr,
        &cookie,
        "run",
        json!({"action":"slow","timeout_ms":200}),
    )
    .await;
    assert_eq!(slow["result"]["timed_out"], true);
    assert!(slow["result"]["duration_ms"].as_u64().unwrap() < 5000);
    let big = call(&addr, &cookie, "run", json!({"action":"big"})).await;
    assert_eq!(big["result"]["stdout_truncated"], true);
    assert_eq!(big["result"]["stdout"].as_str().unwrap().len(), 1024 * 1024);
    assert_eq!(
        call(&addr, &cookie, "run", json!({"action":"twin"})).await["error"]["code"],
        "ambiguous_action"
    );
    assert_eq!(
        call(&addr, &cookie, "run", json!({"action":"twin.sh"})).await["result"]["exit_code"],
        0
    );
    assert_eq!(
        call(&addr, &cookie, "run", json!({"action":"nope"})).await["error"]["code"],
        "no_action"
    );
    for bad in ["../x", "/bin/sh", "a/b", ".hidden", ""] {
        assert_eq!(
            call(&addr, &cookie, "run", json!({"action":bad})).await["error"]["code"],
            "invalid_action",
            "{bad}"
        );
    }
    assert_eq!(
        call(&addr, &cookie, "run", json!({"action":"plain.txt"})).await["error"]["code"],
        "run_failed"
    );
}

#[tokio::test]
async fn an_app_keeps_its_origin_across_restarts_and_stops_with_the_bridge() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE]);
    let (addr, _) = open(&f, "one").await;
    let saved: Value =
        serde_json::from_slice(&std::fs::read(f.root.join("state/app-ports.json")).unwrap())
            .unwrap();
    assert_eq!(format!("127.0.0.1:{}", saved["one"]), addr);
    // Stopping waits for the listeners. Whether the port is then free isn't asserted: tests running
    // alongside take ports from the same neighbourhood, and a taken port only moves an app.
    f.cancel.cancel();
    tokio::time::timeout(
        Duration::from_secs(5),
        f.state.apps.as_ref().unwrap().stopped(),
    )
    .await
    .expect("the app listeners end with the bridge");
}

#[tokio::test]
async fn data_changes_from_outside_reach_the_page_through_one_watcher() {
    let f = fixture().await;
    write_app(&f.apps, "one", "{}", &[PAGE, ("data/start.txt", "x")]);
    let (addr, cookie) = open(&f, "one").await;
    let first = call(&addr, &cookie, "data.wait", json!({})).await;
    let mut version = first["result"]["version"].clone();
    assert_eq!(
        first["result"]["changed"], false,
        "the first call only learns where things stand"
    );
    // A Thread's shell writing, not the API. One sample each, on loopback: a record, not a bound.
    let mut samples = Vec::new();
    for (n, file) in ["a.json", "sub/b.json", "a.json"].iter().enumerate() {
        let (a, c, v) = (addr.clone(), cookie.clone(), version.clone());
        let waiting =
            tokio::spawn(async move { call(&a, &c, "data.wait", json!({"version": v})).await });
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
    let out = call(&addr, &cookie, "data.wait", json!({"version": version})).await;
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
    let (addr, cookie) = open(&f, "one").await;
    let (a, c) = (addr.clone(), cookie.clone());
    let first = tokio::spawn(async move { call(&a, &c, "run", json!({"action":"slow"})).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    let second = call(&addr, &cookie, "run", json!({"action":"slow"})).await;
    assert_eq!(second["error"]["code"], "already_running", "{second}");
    // Another action isn't held up.
    let other = call(&addr, &cookie, "run", json!({"action":"other"})).await;
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
        call(
            &addr,
            &cookie,
            "run",
            json!({"action":"slow","timeout_ms":100})
        )
        .await["result"]["timed_out"],
        true
    );
    assert_eq!(
        call(&addr, &cookie, "run", json!({"action":"slow"})).await["result"]["timed_out"],
        false,
        "finished or timed out, it can run again"
    );
}
