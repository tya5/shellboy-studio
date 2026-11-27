//! Apps: small web apps in folders, hosted by the gateway on the Web UI's own port. Each page runs in a
//! sandboxed iframe with an opaque origin, reaches Shellboy only through the API forwarded by its parent
//! frame, and never sees the Web UI's token or cookie. See `docs/design/apps.md`.
//!
//! Bounds (limits, not performance claims): `catalog::MAX_APPS` hosted (a listing is one Core page of 32 per request); `MAX_SESSIONS` file
//! sessions, oldest dropped; `CALLS` backend calls at once; owner calls share the bridge's
//! global semaphore; one hub session per app while `thread.onChange` waits and 30 s after; one lifecycle
//! task per app while a page waits (data walks only for `data.onChange`). An unused host gives up its slot when a new app needs one.
mod backend;
pub mod catalog;
mod host;

use crate::{hub::Hub, owner::Owner};
use axum::{
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use catalog::{Kind, Latest};
use serde_json::{Value, json};
use shellboy::protocol::{ArtifactReadArgs, Command};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub use host::AppHost;

const GUIDE: &str = include_str!("README.md");
const CALLS: usize = 4;
const MAX_SESSIONS: usize = 256;
const MAX_INSTANCES: usize = 128;
/// The only file of a static page, and the entry of an app.
const ENTRY: &str = "index.html";

/// A portable data directory component. Keep aligned with the Web route parser.
pub fn valid_instance_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 40
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The one place that decides where an app's files are. A path on whatever host the Web UI was reached
/// by, so a tunnel that forwards one port carries apps too. Apps use relative URLs, so changing this
/// touches no app.
pub fn app_url(session: &str, entry: &str) -> String {
    format!("/a/{session}/{entry}")
}

/// What a file session serves: one exact saved version of one artifact, fixed when the session was
/// minted. Reopening or reloading reads the latest version again.
#[derive(Clone)]
struct Opened {
    thread: String,
    artifact: String,
    version: i64,
    /// A static page: only `ENTRY`, with no app API and no neighbouring files.
    page: bool,
}

type Fail = (&'static str, String);

/// An owner error as an app failure. An artifact the owner does not know is an app that is not there.
fn owner_fail(error: Value) -> Fail {
    let message = error["message"]
        .as_str()
        .unwrap_or("The owner refused")
        .to_owned();
    match error["code"].as_str() {
        Some("target_unavailable") => ("app_not_found", message),
        _ => ("owner_failed", message),
    }
}

/// Why a file could not be read through the owner.
pub(crate) enum ReadFail {
    /// The owner has no such file.
    Missing,
    Status(StatusCode),
}

pub struct Apps<O> {
    pub(crate) owner: Arc<O>,
    pub(crate) hub: Arc<Hub>,
    pub(crate) global: Arc<Semaphore>,
    pub(crate) calls: Semaphore,
    hosts: tokio::sync::Mutex<HashMap<String, Arc<AppHost<O>>>>,
    instance_writes: tokio::sync::Mutex<()>,
    /// Which version a file session serves. In memory: a restart ends them, and the Web UI opens again.
    sessions: Mutex<VecDeque<(String, Opened)>>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    cancel: CancellationToken,
}

impl<O: Owner> Apps<O> {
    pub fn new(
        owner: Arc<O>,
        hub: Arc<Hub>,
        global: Arc<Semaphore>,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            hub,
            global,
            calls: Semaphore::new(CALLS),
            hosts: tokio::sync::Mutex::new(HashMap::new()),
            instance_writes: tokio::sync::Mutex::new(()),
            sessions: Mutex::new(VecDeque::new()),
            tasks: Mutex::new(Vec::new()),
            cancel,
        })
    }

    /// One owner read or call, under the bridge's shared call bound.
    pub(crate) async fn owner_value(&self, command: Command) -> Result<Value, Value> {
        let _permit = self
            .global
            .acquire()
            .await
            .map_err(|_| json!({"code":"shutting_down","message":"The gateway is stopping"}))?;
        match self.owner.call(command, None, None).await {
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

    async fn latest(&self, name: &str) -> Result<Latest, Fail> {
        catalog::latest(&|command| self.owner_value(command), name)
            .await
            .map_err(owner_fail)
    }

    /// One page of a Thread's apps: its `shellboy-app:` artifacts, read from the owner on each call.
    pub async fn list(&self, thread: &str, cursor: Option<&str>) -> Result<Value, Fail> {
        if thread.is_empty() {
            return Err((
                "invalid_args",
                "Name the Thread whose apps to list".to_owned(),
            ));
        }
        let (apps, next_cursor) = catalog::list(
            &|command| self.owner_value(command),
            thread,
            cursor.map(str::to_owned),
        )
        .await
        .map_err(owner_fail)?;
        Ok(json!({"apps": apps, "next_cursor": next_cursor}))
    }

    /// The app host for an artifact whose latest version is an app. A host is replaced when the app's
    /// folder changed, and an unused one is dropped when the table is full.
    async fn host(self: &Arc<Self>, name: &str) -> Result<(Arc<AppHost<O>>, Latest), Fail> {
        let latest = self.latest(name).await?;
        let Some(Kind::App(folder)) = latest.kind() else {
            return Err((
                "not_an_app",
                format!("{name} is not a shellboy-app: artifact"),
            ));
        };
        let mut hosts = self.hosts.lock().await;
        if let Some(h) = hosts.get(name)
            && h.dir == folder
        {
            return Ok((h.clone(), latest));
        }
        if !hosts.contains_key(name) && hosts.len() >= catalog::MAX_APPS {
            hosts.retain(|_, host| Arc::strong_count(host) > 1);
            if hosts.len() >= catalog::MAX_APPS {
                return Err(("too_many_apps", "Too many apps are open".to_owned()));
            }
        }
        let host = AppHost::new(name.to_owned(), folder, self.clone());
        hosts.insert(name.to_owned(), host.clone());
        Ok((host, latest))
    }

    /// Persist a bounded list independently of app data; names are never paths supplied verbatim.
    pub async fn instances(self: &Arc<Self>, name: &str) -> Result<Vec<String>, Fail> {
        let (host, _) = self.host(name).await?;
        let path = host.dir.join(".instances.json");
        use tokio::io::AsyncReadExt;
        let file = match tokio::fs::File::open(path).await {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(("io_failed", e.to_string())),
        };
        let mut bytes = Vec::new();
        file.take(8193)
            .read_to_end(&mut bytes)
            .await
            .map_err(|e| ("io_failed", e.to_string()))?;
        if bytes.len() > 8192 {
            return Err(("invalid_instances", "Instance registry is too large".into()));
        }
        let names: Vec<String> =
            serde_json::from_slice(&bytes).map_err(|e| ("invalid_instances", e.to_string()))?;
        if names.len() > MAX_INSTANCES || names.iter().any(|n| !valid_instance_name(n)) {
            return Err(("invalid_instances", "Invalid instance registry".into()));
        }
        Ok(names)
    }

    pub async fn add_instance(self: &Arc<Self>, name: &str, instance: &str) -> Result<Value, Fail> {
        if !valid_instance_name(instance) {
            return Err(("invalid_instance", "Invalid instance name".into()));
        }
        let _guard = self.instance_writes.lock().await;
        let mut names = self.instances(name).await?;
        if !names.iter().any(|n| n == instance) {
            if names.len() >= MAX_INSTANCES {
                return Err(("too_many_instances", "Too many instances".into()));
            }
            names.push(instance.to_owned());
            names.sort();
            let (host, _) = self.host(name).await?;
            let path = host.dir.join(".instances.json");
            let tmp = host.dir.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
            let bytes = serde_json::to_vec(&names).map_err(|e| ("io_failed", e.to_string()))?;
            tokio::fs::write(&tmp, bytes)
                .await
                .map_err(|e| ("io_failed", e.to_string()))?;
            if let Err(e) = tokio::fs::rename(&tmp, &path).await {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(("io_failed", e.to_string()));
            }
        }
        Ok(json!({"items": names}))
    }

    /// A relative URL that serves the artifact's latest version: a fresh session in the path. An app
    /// gets a host (and the API); a `text/html` artifact of any other kind is one static page.
    pub async fn open(self: &Arc<Self>, name: &str) -> Result<Value, Fail> {
        let latest = self.latest(name).await?;
        let page = match latest.kind() {
            Some(Kind::App(_)) => {
                self.host(name).await?;
                false
            }
            Some(Kind::Page) => true,
            None => {
                return Err((
                    "not_an_app",
                    format!("{name} is neither a shellboy-app: folder nor an HTML page"),
                ));
            }
        };
        let session = uuid::Uuid::new_v4().simple().to_string();
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
            while sessions.len() >= MAX_SESSIONS {
                sessions.pop_front();
            }
            sessions.push_back((
                session.clone(),
                Opened {
                    thread: latest.thread.clone(),
                    artifact: latest.artifact.clone(),
                    version: latest.version,
                    page,
                },
            ));
        }
        Ok(
            json!({"name": name, "url": app_url(&session, ENTRY), "thread": latest.thread, "title": latest.title, "page": page}),
        )
    }

    /// One API call, with the app named by the parent frame and never by the page.
    pub async fn call(self: &Arc<Self>, name: &str, op: &str, args: Value) -> Value {
        self.call_instance(name, op, args, None).await
    }

    pub async fn call_instance(
        self: &Arc<Self>,
        name: &str,
        op: &str,
        args: Value,
        instance: Option<&str>,
    ) -> Value {
        match self.host(name).await {
            Ok((host, latest)) => host.call(op, args, instance, &latest).await,
            Err((code, message)) => {
                json!({"ok": false, "error": {"code": code, "message": message}})
            }
        }
    }

    /// One file of an opened version, read through the owner.
    pub async fn file(self: &Arc<Self>, session: &str, path: &str, method: &Method) -> Response {
        let opened = {
            let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
            sessions
                .iter()
                .find(|(s, _)| s == session)
                .map(|(_, opened)| opened.clone())
        };
        let Some(opened) = opened else {
            return StatusCode::NOT_FOUND.into_response();
        };
        host::serve_file(self, &opened, method, path).await
    }

    /// The bytes of one file of the opened version. Only the owner's `target_unavailable` means the file
    /// is missing; a refusal is a plain 404, and anything else is the gateway's failure.
    async fn read_file(&self, opened: &Opened, path: Option<&str>) -> Result<Vec<u8>, ReadFail> {
        let read = Command::ArtifactRead(ArtifactReadArgs {
            thread_id: opened.thread.clone(),
            artifact_id: opened.artifact.clone(),
            version: opened.version,
            path: path.map(str::to_owned),
        });
        match self.owner_value(read).await {
            Ok(content) => content["base64"]
                .as_str()
                .and_then(|text| base64::engine::general_purpose::STANDARD.decode(text).ok())
                .ok_or(ReadFail::Status(StatusCode::BAD_GATEWAY)),
            Err(error) => Err(match error["code"].as_str() {
                Some("target_unavailable") => ReadFail::Missing,
                Some("input_limit") => ReadFail::Status(StatusCode::PAYLOAD_TOO_LARGE),
                Some("invalid_argument") => ReadFail::Status(StatusCode::NOT_FOUND),
                Some("shutting_down") => ReadFail::Status(StatusCode::SERVICE_UNAVAILABLE),
                _ => ReadFail::Status(StatusCode::BAD_GATEWAY),
            }),
        }
    }

    /// The guide a model reads, served beside `api.js`, so it always matches this gateway's API.
    pub fn guide() -> Response {
        (
            [
                (header::CONTENT_TYPE, "text/markdown; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            GUIDE,
        )
            .into_response()
    }

    pub fn api_js() -> Response {
        (
            [
                (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            host::API_JS,
        )
            .into_response()
    }

    pub fn ui_css() -> Response {
        (
            [
                (header::CONTENT_TYPE, "text/css; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            host::UI_CSS,
        )
            .into_response()
    }

    pub(crate) fn cancel_token(&self) -> CancellationToken {
        self.cancel.clone()
    }

    /// A task that ends on `cancel`. Finished ones are dropped here, so the list stays short.
    pub(crate) fn keep_task(&self, task: tokio::task::JoinHandle<()>) {
        let mut tasks = self.tasks.lock().unwrap_or_else(|p| p.into_inner());
        tasks.retain(|t| !t.is_finished());
        tasks.push(task);
    }

    /// After `cancel`: wait for the watcher tasks.
    pub async fn stopped(&self) {
        let tasks = std::mem::take(&mut *self.tasks.lock().unwrap_or_else(|p| p.into_inner()));
        for task in tasks {
            let _ = task.await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn instance_names_are_safe_path_components() {
        for name in ["a", "A_2", "x-y"] {
            assert!(valid_instance_name(name));
        }
        for name in ["", ".", "..", "a/b", "a\\b", "%2f", "a.b", "日本"] {
            assert!(!valid_instance_name(name), "{name}");
        }
        assert!(!valid_instance_name(&"a".repeat(41)));
    }

    #[test]
    fn a_url_is_a_path_so_any_host_or_tunnel_carries_it() {
        assert_eq!(
            app_url("abc", "pages/index.html"),
            "/a/abc/pages/index.html"
        );
    }
}
