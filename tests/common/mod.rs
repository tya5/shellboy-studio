//! Test helpers: a scripted mock owner (events.wait replies come from a channel the test
//! controls) and a bridge bound to an ephemeral loopback port.
#![allow(dead_code)]
use serde_json::{Value, json};
use shellboy::protocol::{ApiError, Command, EventsWaitArgs, Origin, Response};
use shellboy_web::{
    auth::Auth,
    events::PollConfig,
    hub::Hub,
    owner::Owner,
    server::{AppState, ServerConfig, Shared, router, serve},
};
use std::{
    future::pending,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub type Reply = Result<Response<Value>, ApiError>;

pub fn ok(instance: &str, result: Value) -> Reply {
    Ok(Response::success(
        format!("{instance}:{}", uuid::Uuid::new_v4()),
        result,
    ))
}

pub fn events(instance: &str, status: &str, cursor: &str, changes: &[&str], more: bool) -> Reply {
    let changes: Vec<Value> = changes
        .iter()
        .enumerate()
        .map(|(i, t)| json!({"thread_id": t, "seq": i + 1}))
        .collect();
    ok(
        instance,
        json!({"status": status, "cursor": cursor, "changes": changes, "more": more}),
    )
}

pub fn unreachable_owner() -> Reply {
    Err(ApiError::new(
        shellboy::protocol::ErrorCode::AppNotRunning,
        "no owner",
    ))
}

type Handler = dyn Fn(&Command) -> Option<Value> + Send + Sync;

pub struct MockOwner {
    events_rx: tokio::sync::Mutex<mpsc::UnboundedReceiver<Reply>>,
    pub event_args: Mutex<Vec<EventsWaitArgs>>,
    pub other_calls: Mutex<Vec<Command>>,
    handler: Box<Handler>,
}

pub fn mock(
    handler: impl Fn(&Command) -> Option<Value> + Send + Sync + 'static,
) -> (Arc<MockOwner>, mpsc::UnboundedSender<Reply>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        Arc::new(MockOwner {
            events_rx: tokio::sync::Mutex::new(rx),
            event_args: Mutex::new(Vec::new()),
            other_calls: Mutex::new(Vec::new()),
            handler: Box::new(handler),
        }),
        tx,
    )
}

impl Owner for MockOwner {
    async fn call(&self, command: Command, _op: Option<String>, _origin: Option<Origin>) -> Reply {
        if let Command::EventsWait(args) = &command {
            self.event_args.lock().unwrap().push(args.clone());
            return match self.events_rx.lock().await.recv().await {
                Some(reply) => reply,
                None => pending().await,
            };
        }
        self.other_calls.lock().unwrap().push(command.clone());
        match (self.handler)(&command) {
            Some(result) => ok("inst1", result),
            None => pending().await,
        }
    }
}

pub fn fast_poll() -> PollConfig {
    PollConfig {
        long_poll_ms: 30_000,
        backoff_min: Duration::from_millis(5),
        backoff_max: Duration::from_millis(20),
    }
}

pub async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let start = std::time::Instant::now();
    while !condition() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "timed out waiting for {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

pub struct Bridge {
    pub addr: std::net::SocketAddr,
    pub state: AppState<MockOwner>,
    pub cancel: CancellationToken,
    pub token: String,
}

pub fn app_state<O: Owner>(
    owner: Arc<O>,
    debug: bool,
    listen: std::net::SocketAddr,
) -> AppState<O> {
    Shared::new(
        owner,
        Hub::new(),
        Auth::new("ab".repeat(32)),
        ServerConfig {
            listen,
            extra_hosts: vec![],
            debug,
        },
    )
}

/// Start the full bridge (HTTP + events loop) on an ephemeral port.
pub async fn start<O: Owner>(
    owner: Arc<O>,
    debug: bool,
) -> (std::net::SocketAddr, AppState<O>, CancellationToken) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = app_state(owner, debug, addr);
    let cancel = CancellationToken::new();
    tokio::spawn(serve(listener, state.clone(), fast_poll(), cancel.clone()));
    (addr, state, cancel)
}

pub fn router_only<O: Owner>(owner: Arc<O>, debug: bool) -> axum::Router {
    router(app_state(owner, debug, "127.0.0.1:8751".parse().unwrap()))
}

/// Session cookie value for a state, obtained the way a browser would (POST /auth).
pub async fn login<O: Owner>(addr: std::net::SocketAddr, state: &AppState<O>) -> String {
    // Raw HTTP/1.1 keeps the test free of an HTTP client dependency.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let body = json!({"token": state.auth.token()}).to_string();
    let request = format!(
        "POST /auth HTTP/1.1\r\nHost: {addr}\r\nOrigin: http://{addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    assert!(response.starts_with("HTTP/1.1 204"), "{response}");
    let line = response
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
        .expect("set-cookie");
    line.split_once(':')
        .unwrap()
        .1
        .trim()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}
