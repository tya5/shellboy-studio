//! One app's origin: its files, its session and the API. Reached only with a session made from a
//! ticket the authenticated Web UI asked for. Cookies ignore ports, so each is named by port and is
//! HttpOnly; `Origin` must equal `Host` on the API, so another app's page can't call it, and the
//! Web UI's `/ws` and `/auth` refuse an app's origin the same way.
use super::{Apps, catalog, run};
use crate::{auth, hub::SessionGuard, owner::Owner};
use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use shellboy::protocol::Command;
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime},
};

pub const TICKET_PARAM: &str = "_sb_ticket";
pub const COOKIE_PREFIX: &str = "sbw_app_";
const MAX_SESSIONS: usize = 16;
const MAX_TICKETS: usize = 16;
const TICKET_LIFE: Duration = Duration::from_secs(60);
const MAX_DATA: usize = 8 * 1024 * 1024;
const MAX_BODY: usize = 12 * 1024 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_LIST: usize = 1000;
const WAIT: Duration = Duration::from_secs(25);
/// How often the one watcher of an app looks at `data/`, while a page is waiting.
const WATCH_INTERVAL: Duration = Duration::from_millis(200);
/// It keeps looking this long after the last wait ends, so a change between two waits isn't missed
/// by a late first look, and then stops.
const WATCH_LINGER: Duration = Duration::from_secs(30);
const WATCH_ENTRIES: usize = 4096;
const WATCH_DEPTH: usize = 8;
const MAX_CHANGED: usize = 64;

const API_JS: &str = include_str!("api.js");
const UI_CSS: &str = concat!(
    include_str!("../../web/designs/console/system/tokens/console.css"),
    include_str!("../../web/designs/console/system/tokens/light.css"),
    include_str!("../../web/designs/console/system/tokens/terminal.css"),
    include_str!("ui.css"),
);

type ApiFail = (&'static str, String);

pub struct AppHost<O> {
    pub name: String,
    dir: PathBuf,
    pub port: u16,
    apps: Arc<Apps<O>>,
    tickets: Mutex<VecDeque<(String, Instant)>>,
    sessions: Mutex<VecDeque<String>>,
    writes: tokio::sync::Mutex<()>,
    hints: tokio::sync::Mutex<Option<SessionGuard>>,
    /// One at a time per action, so a page's timer can't pile up.
    running: Mutex<HashSet<PathBuf>>,
    watch: tokio::sync::watch::Sender<DataSnapshot>,
    watching: AtomicBool,
}

/// What `data/` held at the last look. `version` moves only when something changed.
#[derive(Clone, Default)]
pub struct DataSnapshot {
    version: u64,
    files: BTreeMap<String, (u64, Option<SystemTime>)>,
    changed: Vec<String>,
    truncated: bool,
}

struct Running<'a>(&'a Mutex<HashSet<PathBuf>>, PathBuf);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&self.1);
    }
}

/// Sizes and times of `data/`. Bounded in entries and depth; doesn't follow links; skips the temp
/// files of a write in progress. A blocking walk, so it runs on the blocking pool.
fn scan_data(root: &Path) -> (BTreeMap<String, (u64, Option<SystemTime>)>, bool) {
    let mut files = BTreeMap::new();
    let mut truncated = false;
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(items) = std::fs::read_dir(&dir) else {
            continue;
        };
        for item in items.flatten() {
            seen += 1;
            if seen > WATCH_ENTRIES {
                return (files, true);
            }
            let name = item.file_name();
            if name.to_string_lossy().ends_with(".tmp") && name.to_string_lossy().starts_with('.') {
                continue;
            }
            let Ok(meta) = std::fs::symlink_metadata(item.path()) else {
                continue;
            };
            if meta.is_dir() {
                if depth + 1 < WATCH_DEPTH {
                    stack.push((item.path(), depth + 1));
                } else {
                    truncated = true;
                }
            } else if let Ok(rel) = item.path().strip_prefix(root) {
                files.insert(
                    rel.to_string_lossy().replace('\\', "/"),
                    (meta.len(), meta.modified().ok()),
                );
            }
        }
    }
    (files, truncated)
}

fn differences(
    old: &BTreeMap<String, (u64, Option<SystemTime>)>,
    new: &BTreeMap<String, (u64, Option<SystemTime>)>,
) -> Vec<String> {
    let mut out: Vec<String> = new
        .iter()
        .filter(|(k, v)| old.get(*k) != Some(v))
        .map(|(k, _)| k.clone())
        .collect();
    out.extend(old.keys().filter(|k| !new.contains_key(*k)).cloned());
    out.truncate(MAX_CHANGED);
    out
}

fn random() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn hash_of(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" | "log" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The API goes in first, so an error in any later script is caught. Nothing else in the page changes.
fn inject_api(page: &str) -> String {
    const TAG: &str = "<script src=\"/_shellboy/api.js\"></script>";
    let lower = page.to_ascii_lowercase();
    let after_open = |tag: &str| {
        lower
            .find(tag)
            .and_then(|at| lower[at..].find('>').map(|end| at + end + 1))
    };
    let at = after_open("<head")
        .or_else(|| after_open("<html"))
        .or_else(|| after_open("<!doctype"))
        .unwrap_or(0);
    format!("{}{TAG}{}", &page[..at], &page[at..])
}

fn plain_page(status: StatusCode, title: &str, script: Option<&str>) -> Response {
    let report = script.map_or(String::new(), |m| {
        format!(
            "<script src=\"/_shellboy/api.js\"></script><script>throw new Error({m:?})</script>"
        )
    });
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        format!(
            "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>{report}<p>{title}</p>"
        ),
    )
        .into_response()
}

impl<O: Owner> AppHost<O> {
    pub(super) fn new(name: String, dir: PathBuf, port: u16, apps: Arc<Apps<O>>) -> Arc<Self> {
        Arc::new(Self {
            name,
            dir,
            port,
            apps,
            tickets: Mutex::new(VecDeque::new()),
            sessions: Mutex::new(VecDeque::new()),
            writes: tokio::sync::Mutex::new(()),
            hints: tokio::sync::Mutex::new(None),
            running: Mutex::new(HashSet::new()),
            watch: tokio::sync::watch::channel(DataSnapshot::default()).0,
            watching: AtomicBool::new(false),
        })
    }

    pub(super) fn router(self: Arc<Self>) -> Router {
        Router::new()
            .route(
                "/_shellboy/api.js",
                get(|| async {
                    (
                        [
                            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
                            (header::CACHE_CONTROL, "no-cache"),
                        ],
                        API_JS,
                    )
                }),
            )
            .route(
                "/_shellboy/ui.css",
                get(|| async {
                    (
                        [
                            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
                            (header::CACHE_CONTROL, "no-cache"),
                        ],
                        UI_CSS,
                    )
                }),
            )
            .route(
                "/_shellboy/call",
                post(call::<O>).layer(DefaultBodyLimit::max(MAX_BODY)),
            )
            .fallback(file::<O>)
            .layer(middleware::from_fn_with_state(self.clone(), guard::<O>))
            .with_state(self)
    }

    pub(super) fn issue_ticket(&self) -> String {
        let ticket = random();
        let mut tickets = self.tickets.lock().unwrap_or_else(|p| p.into_inner());
        tickets.retain(|(_, at)| at.elapsed() < TICKET_LIFE);
        while tickets.len() >= MAX_TICKETS {
            tickets.pop_front();
        }
        tickets.push_back((ticket.clone(), Instant::now()));
        ticket
    }

    fn redeem(&self, ticket: &str) -> bool {
        let mut tickets = self.tickets.lock().unwrap_or_else(|p| p.into_inner());
        let found = tickets
            .iter()
            .position(|(t, at)| t == ticket && at.elapsed() < TICKET_LIFE);
        found.map(|i| tickets.remove(i)).is_some()
    }

    fn new_session(&self) -> String {
        let id = random();
        let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        while sessions.len() >= MAX_SESSIONS {
            sessions.pop_front();
        }
        sessions.push_back(id.clone());
        id
    }

    fn cookie_name(&self) -> String {
        format!("{COOKIE_PREFIX}{}", self.port)
    }

    fn has_session(&self, headers: &HeaderMap) -> bool {
        let Some(cookies) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) else {
            return false;
        };
        let want = self.cookie_name();
        let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        cookies
            .split(';')
            .filter_map(|c| c.trim().split_once('='))
            .any(|(k, v)| k == want && sessions.iter().any(|s| s == v))
    }

    /// Follows no symlink out of the app.
    async fn inside(&self, relative: &Path) -> Option<PathBuf> {
        let root = tokio::fs::canonicalize(&self.dir).await.ok()?;
        let full = tokio::fs::canonicalize(self.dir.join(relative))
            .await
            .ok()?;
        full.starts_with(&root).then_some(full)
    }

    fn data_path(&self, args: &Value) -> Result<PathBuf, ApiFail> {
        let path = args.get("path").and_then(Value::as_str).unwrap_or_default();
        catalog::safe_relative(path)
            .map(|rel| Path::new("data").join(rel))
            .ok_or(("invalid_path", format!("{path} isn't a path inside data/")))
    }

    async fn bound(&self, args: &Value) -> Result<String, ApiFail> {
        if let Some(thread) = args
            .get("thread")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
        {
            return Ok(thread.to_owned());
        }
        let entry = catalog::read_entry(&self.apps.dir, &self.name).await;
        entry.and_then(|e| e.thread).ok_or((
            "no_bound_thread",
            "This app has no bound Thread; name one, or set thread in app.json".to_owned(),
        ))
    }

    async fn owner_call(&self, command: Value) -> Result<Value, Value> {
        let parsed: Command = serde_json::from_value(command)
            .map_err(|e| json!({"code":"invalid_args","message":e.to_string()}))?;
        let _permit = self
            .apps
            .global
            .acquire()
            .await
            .map_err(|_| json!({"code":"shutting_down","message":"The gateway is stopping"}))?;
        match self.apps.owner.call(parsed, None, None).await {
            Ok(response) => {
                let value = serde_json::to_value(&response).unwrap_or(Value::Null);
                if value["ok"] == true {
                    Ok(value["result"].clone())
                } else {
                    Err(value["error"].clone())
                }
            }
            Err(api) => Err(serde_json::to_value(&api)
                .unwrap_or(json!({"code":"owner_call_failed","message":api.message}))),
        }
    }

    async fn data_read(&self, args: &Value) -> Result<Value, ApiFail> {
        let rel = self.data_path(args)?;
        let Some(full) = self.inside(&rel).await else {
            return Ok(json!({"exists": false, "text": null, "hash": null}));
        };
        let meta = tokio::fs::metadata(&full)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        if !meta.is_file() {
            return Err(("invalid_path", "That is a folder".to_owned()));
        }
        if meta.len() > MAX_DATA as u64 {
            return Err(("too_large", "The file is over 8 MiB".to_owned()));
        }
        let bytes = tokio::fs::read(&full)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        let hash = hash_of(&bytes);
        let text = String::from_utf8(bytes).map_err(|_| {
            (
                "not_text",
                "The file isn't UTF-8 text; fetch it by its relative URL".to_owned(),
            )
        })?;
        Ok(json!({"exists": true, "text": text, "hash": hash}))
    }

    /// Same-app writes are serialized here. The hash also catches a write from the Thread between
    /// the page's read and this write; temp-and-rename means a reader never sees half a file.
    async fn data_write(&self, args: &Value) -> Result<Value, ApiFail> {
        let rel = self.data_path(args)?;
        let text = args
            .get("text")
            .and_then(Value::as_str)
            .ok_or(("invalid_args", "text is required".to_owned()))?;
        if text.len() > MAX_DATA {
            return Err(("too_large", "The text is over 8 MiB".to_owned()));
        }
        let _one = self.writes.lock().await;
        let full = self.dir.join(&rel);
        let parent = full
            .parent()
            .ok_or(("invalid_path", "No parent folder".to_owned()))?
            .to_owned();
        tokio::fs::create_dir_all(&parent)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        let root = tokio::fs::canonicalize(&self.dir)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        if !tokio::fs::canonicalize(&parent)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?
            .starts_with(&root)
        {
            return Err(("invalid_path", "That path leaves the app".to_owned()));
        }
        if args.get("check") == Some(&Value::Bool(true)) {
            let current = match tokio::fs::read(&full).await {
                Ok(bytes) => Some(hash_of(&bytes)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(("io_failed", e.to_string())),
            };
            if current.as_deref() != args.get("hash").and_then(Value::as_str) {
                return Err(("conflict", "The file changed since it was read".to_owned()));
            }
        }
        let temp = parent.join(format!(".{}.tmp", random()));
        tokio::fs::write(&temp, text)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        if let Err(e) = tokio::fs::rename(&temp, &full).await {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(("io_failed", e.to_string()));
        }
        Ok(json!({"hash": hash_of(text.as_bytes())}))
    }

    async fn data_list(&self, args: &Value) -> Result<Value, ApiFail> {
        let rel = if args.get("path").is_some() {
            self.data_path(args)?
        } else {
            PathBuf::from("data")
        };
        let Some(full) = self.inside(&rel).await else {
            return Ok(json!({"entries": []}));
        };
        let mut dir = tokio::fs::read_dir(&full)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        let mut entries = Vec::new();
        while let Ok(Some(item)) = dir.next_entry().await {
            if entries.len() >= MAX_LIST {
                break;
            }
            let Ok(meta) = item.metadata().await else {
                continue;
            };
            entries.push(json!({"name": item.file_name().to_string_lossy(), "dir": meta.is_dir(), "size": meta.len()}));
        }
        Ok(json!({"entries": entries}))
    }

    /// Change hints from the one shared `events.wait`, held at the hub. No owner connection is used.
    async fn events_wait(&self, args: &Value) -> Result<Value, ApiFail> {
        let thread = self.bound(args).await.ok();
        let list = args.get("list").and_then(Value::as_bool).unwrap_or(false);
        let mut slot = self.hints.lock().await;
        if slot.is_none() {
            *slot = self.apps.hub.register().map(|(guard, _)| guard);
        }
        let guard = slot
            .as_ref()
            .ok_or(("busy", "Too many sessions".to_owned()))?;
        self.apps
            .hub
            .watch(guard, thread.into_iter().collect(), list)
            .map_err(|e| ("invalid_args", e))?;
        let (pending, _) = self.apps.hub.take(guard);
        if pending.threads.is_empty() && !pending.list && !pending.resync {
            let _ = tokio::time::timeout(WAIT, guard.wake.notified()).await;
        }
        let (more, _) = self.apps.hub.take(guard);
        let threads: Vec<String> = pending.threads.into_iter().chain(more.threads).collect();
        let changed =
            !threads.is_empty() || pending.list || more.list || pending.resync || more.resync;
        Ok(json!({"changed": changed, "threads": threads, "list": pending.list || more.list}))
    }

    /// One look at `data/`. Moves the version only if something changed.
    async fn look(self: &Arc<Self>) {
        let root = self.dir.join("data");
        let Ok((files, truncated)) = tokio::task::spawn_blocking(move || scan_data(&root)).await
        else {
            return;
        };
        self.watch.send_if_modified(|snapshot| {
            let changed = differences(&snapshot.files, &files);
            snapshot.truncated = truncated;
            if changed.is_empty() {
                return false;
            }
            snapshot.version += 1;
            snapshot.files = files;
            snapshot.changed = changed;
            true
        });
    }

    /// One task per app, whatever the number of pages. It runs while a page waits, then ends.
    fn ensure_watcher(self: &Arc<Self>) {
        if self.watching.swap(true, Ordering::SeqCst) {
            return;
        }
        let host = self.clone();
        let cancel = self.apps.cancel_token();
        let task = tokio::spawn(async move {
            let mut idle_since = None;
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = tokio::time::sleep(WATCH_INTERVAL) => {}
                }
                host.look().await;
                if host.watch.receiver_count() > 0 {
                    idle_since = None;
                } else if idle_since.get_or_insert_with(Instant::now).elapsed() > WATCH_LINGER {
                    break;
                }
            }
            host.watching.store(false, Ordering::SeqCst);
        });
        self.apps.keep_task(task);
    }

    /// `version` from the last reply; without one, this only says where things stand.
    async fn data_wait(self: &Arc<Self>, args: &Value) -> Result<Value, ApiFail> {
        let mut rx = self.watch.subscribe();
        self.ensure_watcher();
        let Some(known) = args.get("version").and_then(Value::as_u64) else {
            self.look().await;
            let now = rx.borrow_and_update().clone();
            return Ok(
                json!({"version": now.version, "changed": false, "paths": [], "truncated": now.truncated}),
            );
        };
        if rx.borrow_and_update().version == known {
            let _ = tokio::time::timeout(WAIT, rx.changed()).await;
        }
        let now = rx.borrow_and_update().clone();
        let changed = now.version != known;
        Ok(
            json!({"version": now.version, "changed": changed, "paths": if changed { now.changed } else { Vec::new() }, "truncated": now.truncated}),
        )
    }

    async fn run_action(&self, args: &Value) -> Result<Value, ApiFail> {
        let action = args
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let script = run::find_action(&self.dir, action).await?;
        let Some(inside) = self
            .inside(script.strip_prefix(&self.dir).unwrap_or(&script))
            .await
        else {
            return Err(("invalid_action", "That action leaves the app".to_owned()));
        };
        if !self
            .running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(inside.clone())
        {
            return Err(("already_running", format!("{action} is still running")));
        }
        let _one = Running(&self.running, inside.clone());
        let _permit = self
            .apps
            .runs
            .acquire()
            .await
            .map_err(|_| ("shutting_down", "The gateway is stopping".to_owned()))?;
        let timeout = args.get("timeout_ms").and_then(Value::as_u64);
        let result = run::run(
            &self.name,
            &self.dir,
            &inside,
            args.get("args").unwrap_or(&Value::Null),
            timeout,
        )
        .await?;
        serde_json::to_value(result).map_err(|e| ("io_failed", e.to_string()))
    }

    async fn dispatch(self: &Arc<Self>, op: &str, args: Value) -> Result<Value, Value> {
        let fail = |(code, message): ApiFail| json!({"code": code, "message": message});
        match op {
            "app.info" => {
                let entry = catalog::read_entry(&self.apps.dir, &self.name).await;
                Ok(
                    json!({"name": self.name, "title": entry.as_ref().map(|e| e.title.clone()), "thread": entry.and_then(|e| e.thread)}),
                )
            }
            "data.read" => self.data_read(&args).await.map_err(fail),
            "data.write" => self.data_write(&args).await.map_err(fail),
            "data.list" => self.data_list(&args).await.map_err(fail),
            "events.wait" => self.events_wait(&args).await.map_err(fail),
            "data.wait" => self.data_wait(&args).await.map_err(fail),
            "run" => self.run_action(&args).await.map_err(fail),
            "thread.send" => {
                let thread = self.bound(&args).await.map_err(fail)?;
                let text = args.get("text").and_then(Value::as_str).unwrap_or_default();
                let mut send = json!({"thread_id": thread, "text": text, "sender_label": format!("app:{}", self.name)});
                if let Some(deliver) = args.get("deliver") {
                    send["deliver"] = deliver.clone();
                }
                self.owner_call(json!({"command": "message.send", "args": send}))
                    .await
            }
            "thread.get" => {
                let thread = self.bound(&args).await.map_err(fail)?;
                self.owner_call(json!({"command": "thread.get", "args": {"thread_id": thread}}))
                    .await
            }
            "thread.messages" => {
                let thread = self.bound(&args).await.map_err(fail)?;
                let mut read = json!({"thread_id": thread, "limit": args.get("limit").and_then(Value::as_u64).unwrap_or(50).min(200)});
                for key in ["cursor", "since"] {
                    if let Some(v) = args.get(key) {
                        read[key] = v.clone();
                    }
                }
                self.owner_call(json!({"command": "history.list", "args": read}))
                    .await
            }
            "threads.list" => {
                let mut read = json!({"limit": args.get("limit").and_then(Value::as_u64).unwrap_or(50).min(200)});
                for key in ["query", "cursor", "archived"] {
                    if let Some(v) = args.get(key) {
                        read[key] = v.clone();
                    }
                }
                self.owner_call(json!({"command": "thread.list", "args": read}))
                    .await
            }
            _ => Err(json!({"code": "unknown_call", "message": format!("No call named {op}")})),
        }
    }
}

async fn guard<O: Owner>(
    State(host): State<Arc<AppHost<O>>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let ok = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| auth::host_allowed(h, &host.apps.listen, &host.apps.extra_hosts));
    if !ok {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    next.run(request).await
}

async fn call<O: Owner>(
    State(host): State<Arc<AppHost<O>>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let authority = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or_default();
    // A page on any other origin, including another app, stops here.
    if !auth::origin_matches(
        headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()),
        authority,
    ) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !host.has_session(&headers) {
        return (StatusCode::UNAUTHORIZED, "no session").into_response();
    }
    let parsed: Result<Value, _> = serde_json::from_slice(&body);
    let reply = match parsed {
        Err(e) => json!({"ok": false, "error": {"code": "invalid_call", "message": e.to_string()}}),
        Ok(v) => {
            let op = v
                .get("op")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let args = v.get("args").cloned().unwrap_or_else(|| json!({}));
            match host.dispatch(&op, args).await {
                Ok(result) => json!({"ok": true, "result": result}),
                Err(error) => json!({"ok": false, "error": error}),
            }
        }
    };
    ([(header::CACHE_CONTROL, "no-store")], axum::Json(reply)).into_response()
}

async fn file<O: Owner>(
    State(host): State<Arc<AppHost<O>>>,
    method: Method,
    headers: HeaderMap,
    uri: axum::http::Uri,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    // A ticket makes a session, once, and leaves the address bar without it.
    if let Some(ticket) = uri.query().and_then(|q| {
        q.split('&').find_map(|p| {
            p.strip_prefix(TICKET_PARAM)
                .and_then(|r| r.strip_prefix('='))
        })
    }) {
        if !host.redeem(ticket) {
            return plain_page(
                StatusCode::UNAUTHORIZED,
                "This link has been used. Open the app from Apps in Shellboy.",
                None,
            );
        }
        let cookie = format!(
            "{}={}; HttpOnly; SameSite=Strict; Path=/",
            host.cookie_name(),
            host.new_session()
        );
        return (
            StatusCode::SEE_OTHER,
            [
                (header::LOCATION, "/".to_owned()),
                (header::SET_COOKIE, cookie),
                (header::CACHE_CONTROL, "no-store".to_owned()),
            ],
        )
            .into_response();
    }
    if !host.has_session(&headers) {
        return plain_page(
            StatusCode::UNAUTHORIZED,
            "Open this app from Apps in Shellboy.",
            None,
        );
    }
    let raw = uri.path().trim_start_matches('/');
    let is_entry = raw.is_empty();
    let entry = catalog::read_entry(&host.apps.dir, &host.name).await;
    let relative = if is_entry {
        entry
            .as_ref()
            .map_or("index.html".to_owned(), |e| e.entry.clone())
    } else {
        percent_decode(raw)
    };
    let Some(rel) = catalog::safe_relative(&relative) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Scripts in `actions/` run through the API; their source isn't served.
    if rel.starts_with("actions") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let missing = || {
        if is_entry {
            plain_page(
                StatusCode::NOT_FOUND,
                "This app's entry file is missing.",
                Some(&format!("The entry file {relative} is missing")),
            )
        } else {
            StatusCode::NOT_FOUND.into_response()
        }
    };
    let Some(full) = host.inside(&rel).await else {
        return missing();
    };
    let Ok(meta) = tokio::fs::metadata(&full).await else {
        return missing();
    };
    if !meta.is_file() {
        return missing();
    }
    if meta.len() > MAX_FILE {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let Ok(bytes) = tokio::fs::read(&full).await else {
        return missing();
    };
    let kind = content_type(&full);
    let body = if kind.starts_with("text/html") {
        Body::from(inject_api(&String::from_utf8_lossy(&bytes)))
    } else {
        Body::from(bytes)
    };
    let web_ui = super::app_origin(
        headers
            .get(header::HOST)
            .and_then(|h| h.to_str().ok())
            .unwrap_or_default(),
        host.apps.listen.port(),
    );
    (
        [
            (header::CONTENT_TYPE, kind.to_owned()),
            (header::CACHE_CONTROL, "no-cache".to_owned()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            (
                header::CONTENT_SECURITY_POLICY,
                format!("frame-ancestors {web_ui} 'self'"),
            ),
        ],
        body,
    )
        .into_response()
}

fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..=i + 2]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn api_goes_first_in_the_page() {
        let tag = "<script src=\"/_shellboy/api.js\"></script>";
        assert_eq!(
            inject_api("<!doctype html><html><head><title>x</title></head></html>"),
            format!("<!doctype html><html><head>{tag}<title>x</title></head></html>")
        );
        assert_eq!(inject_api("<HTML><body>x"), format!("<HTML>{tag}<body>x"));
        assert_eq!(
            inject_api("<!doctype html><p>x"),
            format!("<!doctype html>{tag}<p>x")
        );
        assert_eq!(inject_api("<p>x"), format!("{tag}<p>x"));
    }
    #[test]
    fn decodes_paths_and_leaves_bad_escapes() {
        assert_eq!(percent_decode("a%20b.txt"), "a b.txt");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
