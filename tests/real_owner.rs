//! The bridge against a real `shellboy serve` from the pinned revision, with a temporary
//! data directory and temporary HOME/XDG (so no user config or data is read). No model is
//! configured or called; the test only creates Threads. Skipped, loudly, unless
//! `SHELLBOY_BIN` points at a `shellboy` binary built from the pinned revision.
mod common;
use common::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use shellboy_web::owner::IpcOwner;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};

/// Owns the `shellboy serve` child. Dropping it (normal end, failed assertion, panic) kills and
/// reaps the process, so a failed test never leaves an owner holding resources such as the
/// build-slot lock inherited from the test runner.
struct Serve {
    child: Child,
    instance: String,
}

impl Drop for Serve {
    fn drop(&mut self) {
        let _ = self.child.kill(); // no-op error if it already exited
        let _ = self.child.wait();
    }
}

fn start_owner(bin: &Path, root: &Path, data: &Path) -> Serve {
    start_owner_with(bin, root, data, "http://127.0.0.1:9/v1")
}

fn start_owner_with(bin: &Path, root: &Path, data: &Path, base_url: &str) -> Serve {
    let home = root.join("home");
    std::fs::create_dir_all(&home).unwrap();
    // A keyless loopback connection nobody listens on: Threads can be created, and any
    // model request would fail locally. No network, no credentials.
    let config = root.join("config.toml");
    std::fs::write(
        &config,
        format!("default_connection = \"local\"\ndefault_model = \"mock\"\n[connections.local]\nbase_url = \"{base_url}\"\n"),
    )
    .unwrap();
    let child = Command::new(bin)
        .args(["serve", "--config"])
        .arg(&config)
        .arg("--data-dir")
        .arg(data)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", &home)
        .env("USERPROFILE", &home)
        .env("XDG_CONFIG_HOME", home.join("xdg-config"))
        .env("XDG_DATA_HOME", home.join("xdg-data"))
        .env("APPDATA", home.join("appdata"))
        .env("LOCALAPPDATA", home.join("localappdata"))
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn shellboy serve");
    // Guard from the moment of spawn: any panic below still kills the child.
    let mut serve = Serve {
        child,
        instance: String::new(),
    };
    let mut lines = BufReader::new(serve.child.stdout.take().unwrap()).lines();
    let ready: Value = loop {
        let line = lines.next().expect("serve stdout").expect("line");
        let value: Value = serde_json::from_str(&line).expect("serve prints JSON rows");
        if value["event"] == "ready" {
            break value;
        }
    };
    // Keep draining stdout so the owner never blocks on a full pipe.
    std::thread::spawn(move || for _ in lines {});
    serve.instance = ready["instance_id"].as_str().unwrap().to_owned();
    serve
}

async fn stop_owner(bin: &Path, data: &Path, mut serve: Serve) {
    let status = tokio::process::Command::new(bin)
        .args(["shutdown", "--data-dir"])
        .arg(data)
        .env_remove("SHELLBOY_DATA_DIR")
        .status()
        .await
        .expect("shutdown");
    assert!(status.success(), "shutdown request");
    let child = &mut serve.child;
    until("owner exit", || child.try_wait().unwrap().is_some()).await;
}

async fn next_t(ws: &mut common_ws::Ws, t: &str) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(30), ws.next())
            .await
            .expect("frame in time")
            .expect("socket open")
            .expect("ws ok");
        if let Message::Text(text) = message {
            let frame: Value = serde_json::from_str(text.as_str()).unwrap();
            if frame["t"] == t {
                return frame;
            }
        }
    }
}

mod common_ws {
    pub type Ws = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;
}

fn temp_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("shellboy-web-it-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[tokio::test]
async fn hints_and_restart_against_a_real_owner() {
    let Some(bin) = std::env::var_os("SHELLBOY_BIN").map(PathBuf::from) else {
        eprintln!(
            "SKIPPED real_owner: set SHELLBOY_BIN to a shellboy binary built from the pinned revision"
        );
        return;
    };
    let root = temp_root();
    let data = root.join("data");
    let first = start_owner(&bin, &root, &data);
    let first_instance = first.instance.clone();

    let owner = Arc::new(IpcOwner::new(data.clone()));
    let (addr, state, cancel) = start(owner, true).await;
    let cookie = login(addr, &state).await;
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", format!("http://{addr}").parse().unwrap());
    request
        .headers_mut()
        .insert("cookie", cookie.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    next_t(&mut ws, "hello").await;
    ws.send(Message::Text(
        json!({"t":"watch","thread_ids":[],"list":true})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    // The first owner frame says connected, with the instance and no capabilities (protocol 2).
    let connected = if matches!(
        state.hub.owner_state(),
        shellboy_web::envelope::OwnerState::Connected { .. }
    ) {
        None
    } else {
        Some(next_t(&mut ws, "owner").await)
    };
    if let Some(frame) = connected {
        assert_eq!(
            frame["owner"]["info"]["instance_id"],
            first_instance.as_str()
        );
    }

    // A mutation through the proxy produces a hint for the list tab.
    let started = std::time::Instant::now();
    ws.send(Message::Text(
        json!({"t":"call","id":1,"command":"thread.create","args":{"cwd": root.to_str().unwrap()},"operation_id": format!("{first_instance}:web-it-1")})
            .to_string().into(),
    ))
    .await
    .unwrap();
    let created = next_t(&mut ws, "result").await;
    assert_eq!(created["response"]["ok"], true, "{created}");
    let thread_id = created["response"]["result"]["thread_id"]
        .as_str()
        .expect("thread id")
        .to_owned();
    let changed = next_t(&mut ws, "changed").await;
    eprintln!(
        "observed: create -> changed hint after {:?} (one sample, loopback, not a bound)",
        started.elapsed()
    );
    assert_eq!(changed["list"], true);

    // Hints are not data: the tab re-reads and finds the Thread.
    ws.send(Message::Text(
        json!({"t":"call","id":2,"command":"thread.list","args":{}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let listed = next_t(&mut ws, "result").await;
    assert!(
        listed["response"]["result"]
            .to_string()
            .contains(&thread_id),
        "{listed}"
    );

    // The Analytics and Settings reads pass the allowlist and the owner decodes them: strict
    // decoding on both sides, so a wrong argument name here would fail.
    let reads = [
        (
            "usage.get",
            json!({"group_by":"day","timezone":"+09:00","since":"2026-11-01T00:00:00.000Z","until":"2026-11-08T00:00:00.000Z","limit":168}),
        ),
        (
            "usage.get",
            json!({"group_by":"thread","timezone":"+09:00","since":"2026-11-01T00:00:00.000Z","until":"2026-11-08T00:00:00.000Z","limit":168}),
        ),
        ("compact.list", json!({"thread_id":thread_id,"limit":50})),
        ("storage.status", json!({})),
        ("index.status", json!({})),
        ("status", json!({"memory":true})),
        ("status", json!({"limit":1})),
    ];
    let mut replies = Vec::new();
    for (n, (command, args)) in reads.iter().enumerate() {
        ws.send(Message::Text(
            json!({"t":"call","id":100 + n,"command":command,"args":args})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let reply = next_t(&mut ws, "result").await;
        assert_eq!(reply["id"], 100 + n, "{reply}");
        assert_eq!(reply["response"]["ok"], true, "{command}: {reply}");
        replies.push(reply["response"]["result"].clone());
    }
    assert_eq!(replies[0]["group_by"], "day");
    assert_eq!(replies[0]["more"], false);
    assert!(replies[2]["items"].is_array());
    assert!(replies[3]["logical_live_bytes"].is_u64());
    assert!(replies[3]["warning"].is_boolean());
    assert!(replies[4]["spaces"].is_array());
    assert!(replies[5]["caches"]["replay"]["limit_bytes"].is_u64());
    assert!(replies[6]["receipt_budget"]["limit_bytes"].is_u64());
    // Nothing the owner returned here names a credential.
    for reply in &replies {
        let text = reply.to_string().to_lowercase();
        assert!(!text.contains("api_key"), "{text}");
    }
    // Collection has no preview at this version, so the bridge refuses it.
    ws.send(Message::Text(
        json!({"t":"call","id":200,"command":"storage.collect","args":{"category":"raw"},"operation_id": format!("{first_instance}:web-it-2")})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let refused = next_t(&mut ws, "result").await;
    assert_eq!(refused["error"]["code"], "not_allowed", "{refused}");

    // Owner restart on the same data directory: restarted + resync, new instance.
    stop_owner(&bin, &data, first).await;
    let unreachable = next_t(&mut ws, "owner").await;
    assert_eq!(unreachable["event"], "unreachable");
    let second = start_owner(&bin, &root, &data);
    assert_ne!(second.instance, first_instance);
    let back = next_t(&mut ws, "owner").await;
    assert_eq!(back["event"], "restarted", "{back}");
    assert_eq!(
        back["owner"]["info"]["instance_id"],
        second.instance.as_str()
    );
    next_t(&mut ws, "resync").await;

    cancel.cancel();
    stop_owner(&bin, &data, second).await;
    let _ = std::fs::remove_dir_all(&root);
}

/// A loopback stand-in for a Responses endpoint: every request gets one finished reply. No network
/// beyond loopback and no credentials. Ends when the test's runtime does.
async fn mock_provider() -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut seen = Vec::new();
                let mut chunk = [0u8; 8192];
                loop {
                    let Ok(n) = socket.read(&mut chunk).await else {
                        return;
                    };
                    if n == 0 {
                        return;
                    }
                    seen.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&seen);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                let l = l.to_ascii_lowercase();
                                l.strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                            })
                            .unwrap_or(0);
                        if seen.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let item = json!({"id":"m","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"done"}]});
                let reply = json!({"type":"response.completed","response":{"id":"r","status":"completed","output":[item],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":11}}});
                let body = format!("data: {reply}\n\n");
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(body.as_bytes()).await;
            });
        }
    });
    format!("http://{addr}/v1")
}

struct Client {
    ws: common_ws::Ws,
    next: u64,
}

impl Client {
    async fn call(&mut self, command: &str, args: Value, operation_id: Option<String>) -> Value {
        self.next += 1;
        let id = self.next;
        let mut frame = json!({"t":"call","id":id,"command":command,"args":args});
        if let Some(op) = operation_id {
            frame["operation_id"] = json!(op);
        }
        self.ws
            .send(Message::Text(frame.to_string().into()))
            .await
            .unwrap();
        loop {
            let reply = next_t(&mut self.ws, "result").await;
            if reply["id"] == id {
                return reply;
            }
        }
    }
    async fn ok(&mut self, command: &str, args: Value, operation_id: Option<String>) -> Value {
        let reply = self.call(command, args, operation_id).await;
        assert_eq!(reply["response"]["ok"], true, "{command}: {reply}");
        reply["response"]["result"].clone()
    }
    /// A Thread's activity word, from the saved list.
    async fn settled(&mut self, thread: &str) {
        for _ in 0..200 {
            let got = self
                .ok("thread.get", json!({"thread_id":thread}), None)
                .await;
            if got.get("run_id").is_none_or(Value::is_null) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("thread did not settle");
    }
}

#[tokio::test]
async fn branches_fork_rewind_and_unarchive_against_a_real_owner() {
    let Some(bin) = std::env::var_os("SHELLBOY_BIN").map(PathBuf::from) else {
        eprintln!("SKIPPED real_owner: set SHELLBOY_BIN");
        return;
    };
    let root = temp_root();
    let data = root.join("data");
    let url = mock_provider().await;
    let serve = start_owner_with(&bin, &root, &data, &url);
    let instance = serve.instance.clone();
    let op = |n: &str| Some(format!("{instance}:web-it-{n}"));

    let owner = Arc::new(IpcOwner::new(data.clone()));
    let (addr, state, cancel) = start(owner, true).await;
    let cookie = login(addr, &state).await;
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", format!("http://{addr}").parse().unwrap());
    request
        .headers_mut()
        .insert("cookie", cookie.parse().unwrap());
    let (ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let mut c = Client { ws, next: 0 };
    next_t(&mut c.ws, "hello").await;

    let thread = c
        .ok(
            "thread.create",
            json!({"cwd": root.to_str().unwrap()}),
            op("create"),
        )
        .await;
    let thread = thread["thread_id"].as_str().unwrap().to_owned();
    for (n, text) in ["first", "second", "third"].iter().enumerate() {
        c.ok(
            "message.send",
            json!({"thread_id":thread,"text":text}),
            op(&format!("send-{n}")),
        )
        .await;
        c.settled(&thread).await;
    }
    let history = c
        .ok(
            "history.list",
            json!({"thread_id":thread,"limit":200}),
            None,
        )
        .await;
    let nodes: Vec<&Value> = history["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["kind"] == "assistant_response")
        .collect();
    assert!(nodes.len() >= 2, "{history}");
    let point = nodes[0]["node_id"].as_str().unwrap().to_owned();

    // A Thread alone: the root, no divergence, sized by the owner.
    let alone = c
        .ok(
            "thread.branches",
            json!({"thread_id":thread,"limit":200}),
            None,
        )
        .await;
    assert_eq!(alone["items"].as_array().unwrap().len(), 1, "{alone}");
    assert!(alone["items"][0]["divergence"].is_null());
    assert!(alone["items"][0]["size"]["path_nodes"].is_u64());

    // A dry run changes nothing and names what would leave.
    let preview = c
        .ok(
            "thread.rewind",
            json!({"thread_id":thread,"node_id":point,"dry_run":true}),
            None,
        )
        .await;
    assert_eq!(preview["dry_run"], true);
    assert!(
        preview.get("branch_thread_id").is_none_or(Value::is_null),
        "{preview}"
    );
    assert!(preview["removed"]["nodes"].as_u64().unwrap() > 0);
    assert_eq!(
        c.ok("thread.branches", json!({"thread_id":thread}), None)
            .await["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // Fork: a child with a real divergence, parent unchanged.
    let fork = c
        .ok(
            "thread.fork",
            json!({"thread_id":thread,"node_id":point}),
            op("fork"),
        )
        .await;
    let fork = fork["thread_id"].as_str().unwrap().to_owned();
    let family = c
        .ok(
            "thread.branches",
            json!({"thread_id":thread,"limit":200}),
            None,
        )
        .await;
    let child = family["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["thread_id"] == fork.as_str())
        .unwrap();
    assert_eq!(child["divergence"]["node_id"], point.as_str(), "{family}");
    assert_eq!(child["divergence"]["parent_continues"], true);
    assert_eq!(child["parent_thread_id"], thread.as_str());
    assert!(child["divergence"]["ordinal"].is_u64());
    assert!(child["size"]["nodes_after_divergence"].is_u64());

    // Rewind: the removed part stays as a child, which is the undo path.
    let done = c
        .ok(
            "thread.rewind",
            json!({"thread_id":thread,"node_id":point}),
            op("rewind"),
        )
        .await;
    let kept = done["branch_thread_id"]
        .as_str()
        .expect("branch_thread_id")
        .to_owned();
    let family = c
        .ok(
            "thread.branches",
            json!({"thread_id":thread,"limit":200}),
            None,
        )
        .await;
    let child = family["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["thread_id"] == kept.as_str())
        .unwrap();
    assert_eq!(child["divergence"]["parent_continues"], false, "{family}");

    // A stale cursor would need a family change; a bad one is refused as cursor_expired or invalid.
    let stale = c
        .call(
            "thread.branches",
            json!({"thread_id":thread,"limit":1,"cursor":"nope"}),
            None,
        )
        .await;
    assert_eq!(stale["response"]["ok"], false, "{stale}");

    // Archive and unarchive with descendants, then a list in each mode.
    let archived = c
        .ok(
            "thread.archive",
            json!({"thread_ids":[thread],"descendants":true}),
            op("archive"),
        )
        .await;
    assert!(
        archived["archived"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t == kept.as_str()),
        "{archived}"
    );
    let only = c
        .ok("thread.list", json!({"archived":"only","limit":200}), None)
        .await;
    assert_eq!(only["items"].as_array().unwrap().len(), 3, "{only}");
    let back = c
        .ok(
            "thread.unarchive",
            json!({"thread_ids":[thread],"descendants":true}),
            op("unarchive"),
        )
        .await;
    assert!(
        back["unarchived"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t == fork.as_str()),
        "{back}"
    );

    drop(c);
    cancel.cancel();
    drop(serve);
    let _ = std::fs::remove_dir_all(&root);
}

/// A throwaway app in a temp folder, against a real owner: what a page sends is recorded as from the app.
#[tokio::test]
async fn an_app_message_is_recorded_as_from_the_app() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Some(bin) = std::env::var_os("SHELLBOY_BIN").map(PathBuf::from) else {
        eprintln!("SKIPPED real_owner: set SHELLBOY_BIN");
        return;
    };
    let root = temp_root();
    let data = root.join("data");
    let url = mock_provider().await;
    let serve_owner = start_owner_with(&bin, &root, &data, &url);
    let owner = Arc::new(IpcOwner::new(data.clone()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let cancel = tokio_util::sync::CancellationToken::new();
    let state = shellboy_web::server::Shared::with_apps(
        owner.clone(),
        shellboy_web::hub::Hub::new(),
        shellboy_web::auth::Auth::new("ab".repeat(32)),
        shellboy_web::server::ServerConfig {
            listen: addr,
            extra_hosts: vec![],
            debug: false,
        },
        Some(shellboy_web::server::AppsPaths {
            dir: root.join("apps"),
            state_dir: root.join("state"),
        }),
        cancel.clone(),
    );
    tokio::spawn(shellboy_web::server::serve(
        listener,
        state.clone(),
        fast_poll(),
        cancel.clone(),
    ));
    let created = shellboy_web::owner::Owner::call(
        &*owner,
        shellboy::protocol::Command::ThreadCreate(
            serde_json::from_value(json!({"cwd": root.to_str().unwrap()})).unwrap(),
        ),
        None,
        None,
    )
    .await
    .unwrap();
    let thread = serde_json::to_value(&created).unwrap()["result"]["thread_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let dir = root.join("apps/probe");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("app.json"), json!({"thread": thread}).to_string()).unwrap();
    std::fs::write(dir.join("index.html"), "<!doctype html><title>x</title>").unwrap();

    let opened = state
        .apps
        .as_ref()
        .unwrap()
        .open("probe", &addr.to_string())
        .await
        .unwrap();
    let origin = opened["origin"].as_str().unwrap().to_owned();
    let app_addr = origin.trim_start_matches("http://").to_owned();
    let path = opened["url"].as_str().unwrap()[origin.len()..].to_owned();
    let http = |request: String| {
        let app_addr = app_addr.clone();
        async move {
            let mut s = tokio::net::TcpStream::connect(&app_addr).await.unwrap();
            s.write_all(request.as_bytes()).await.unwrap();
            let mut text = String::new();
            s.read_to_string(&mut text).await.unwrap();
            text
        }
    };
    let first = http(format!(
        "GET {path} HTTP/1.1\r\nHost: {app_addr}\r\nConnection: close\r\n\r\n"
    ))
    .await;
    let cookie = first
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
    let post = |op: &str, args: Value| {
        let body = json!({"op": op, "args": args}).to_string();
        http(format!(
            "POST /_shellboy/call HTTP/1.1\r\nHost: {app_addr}\r\nOrigin: {origin}\r\nCookie: {cookie}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        ))
    };
    let result = |raw: String| -> Value {
        serde_json::from_str(raw.split_once("\r\n\r\n").unwrap().1).unwrap()
    };

    let sent = result(post("thread.send", json!({"text": "from the page"})).await);
    assert_eq!(sent["ok"], true, "{sent}");
    let mut sender = Value::Null;
    for _ in 0..200 {
        let read = result(post("thread.messages", json!({"limit": 50})).await);
        assert_eq!(read["ok"], true, "{read}");
        if let Some(item) = read["result"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["kind"] == "user")
        {
            sender = item["provenance"]["sender"].clone();
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(sender["label"], "app:probe", "{sender}");
    assert_ne!(sender["kind"], "human", "{sender}");

    // The bound Thread goes: the owner's error reaches the page, and its own data still works.
    let gone = result(
        post(
            "thread.send",
            json!({"text": "x", "thread": "no-such-thread"}),
        )
        .await,
    );
    assert_eq!(gone["ok"], false, "{gone}");
    assert_eq!(gone["error"]["code"], "thread_not_found", "{gone}");
    assert_eq!(
        result(post("data.write", json!({"path": "k.txt", "text": "ok"})).await)["ok"],
        true
    );

    cancel.cancel();
    drop(serve_owner);
    let _ = std::fs::remove_dir_all(&root);
}
