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
    let home = root.join("home");
    std::fs::create_dir_all(&home).unwrap();
    // A keyless loopback connection nobody listens on: Threads can be created, and any
    // model request would fail locally. No network, no credentials.
    let config = root.join("config.toml");
    std::fs::write(
        &config,
        "default_connection = \"local\"\ndefault_model = \"mock\"\n[connections.local]\nbase_url = \"http://127.0.0.1:9/v1\"\n",
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
