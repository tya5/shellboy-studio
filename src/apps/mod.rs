//! Apps: small web apps in folders, hosted by the gateway on the Web UI's own port. Each page runs in a
//! sandboxed iframe with an opaque origin, reaches Shellboy only through the API forwarded by its parent
//! frame, and never sees the Web UI's token or cookie. See `docs/design/apps.md`.
//!
//! Bounds (limits, not performance claims): `catalog::MAX_APPS` listed and hosted; `MAX_SESSIONS` file
//! sessions, oldest dropped; `RUNS` scripts at once and one per action; owner calls share the bridge's
//! global semaphore; one hub session per app that uses `thread.onChange`; one `data/` watcher task per app
//! while a page waits.
pub mod catalog;
mod host;
pub mod run;

use crate::{hub::Hub, owner::Owner};
use axum::{
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub use host::AppHost;

const GUIDE: &str = include_str!("README.md");
const RUNS: usize = 4;
const MAX_SESSIONS: usize = 256;

/// The one place that decides where an app's files are. A path on whatever host the Web UI was reached
/// by, so a tunnel that forwards one port carries apps too. Apps use relative URLs, so changing this
/// touches no app.
pub fn app_url(session: &str, entry: &str) -> String {
    format!("/a/{session}/{entry}")
}

pub struct Apps<O> {
    pub dir: PathBuf,
    pub(crate) owner: Arc<O>,
    pub(crate) hub: Arc<Hub>,
    pub(crate) global: Arc<Semaphore>,
    pub(crate) runs: Semaphore,
    hosts: tokio::sync::Mutex<HashMap<String, Arc<AppHost<O>>>>,
    /// Which app a file session belongs to. In memory: a restart ends them, and the Web UI opens again.
    sessions: Mutex<VecDeque<(String, String)>>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    cancel: CancellationToken,
}

impl<O: Owner> Apps<O> {
    pub fn new(
        dir: PathBuf,
        owner: Arc<O>,
        hub: Arc<Hub>,
        global: Arc<Semaphore>,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        // The guide a model reads. Rewritten each start, so it matches this gateway's API.
        if let Err(e) =
            std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join("README.md"), GUIDE))
        {
            eprintln!(
                "shellboy-web: cannot write the apps guide in {}: {e}",
                dir.display()
            );
        }
        Arc::new(Self {
            dir,
            owner,
            hub,
            global,
            runs: Semaphore::new(RUNS),
            hosts: tokio::sync::Mutex::new(HashMap::new()),
            sessions: Mutex::new(VecDeque::new()),
            tasks: Mutex::new(Vec::new()),
            cancel,
        })
    }

    pub async fn list(&self) -> Result<Value, String> {
        let apps = catalog::list(&self.dir).await?;
        Ok(json!({"dir": self.dir, "guide": self.dir.join("README.md"), "apps": apps}))
    }

    async fn host(self: &Arc<Self>, name: &str) -> Result<Arc<AppHost<O>>, (&'static str, String)> {
        let Some(entry) = catalog::read_entry(&self.dir, name).await else {
            return Err(("app_not_found", format!("No app named {name}")));
        };
        if let Some(problem) = entry.problem {
            return Err(("app_broken", problem));
        }
        let mut hosts = self.hosts.lock().await;
        if let Some(h) = hosts.get(name) {
            return Ok(h.clone());
        }
        if hosts.len() >= catalog::MAX_APPS {
            return Err(("too_many_apps", "Too many apps are open".to_owned()));
        }
        let host = AppHost::new(name.to_owned(), self.dir.join(name), self.clone());
        hosts.insert(name.to_owned(), host.clone());
        Ok(host)
    }

    /// A relative URL that serves the app: a fresh session in the path.
    pub async fn open(self: &Arc<Self>, name: &str) -> Result<Value, (&'static str, String)> {
        self.host(name).await?;
        let entry = catalog::read_entry(&self.dir, name)
            .await
            .ok_or(("app_not_found", format!("No app named {name}")))?;
        let session = uuid::Uuid::new_v4().simple().to_string();
        {
            let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
            while sessions.len() >= MAX_SESSIONS {
                sessions.pop_front();
            }
            sessions.push_back((session.clone(), name.to_owned()));
        }
        Ok(
            json!({"name": name, "url": app_url(&session, &entry.entry), "thread": entry.thread, "title": entry.title}),
        )
    }

    /// One API call, with the app named by the parent frame and never by the page.
    pub async fn call(self: &Arc<Self>, name: &str, op: &str, args: Value) -> Value {
        match self.host(name).await {
            Ok(host) => host.call(op, args).await,
            Err((code, message)) => {
                json!({"ok": false, "error": {"code": code, "message": message}})
            }
        }
    }

    pub async fn file(self: &Arc<Self>, session: &str, path: &str, method: &Method) -> Response {
        let name = {
            let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
            sessions
                .iter()
                .find(|(s, _)| s == session)
                .map(|(_, n)| n.clone())
        };
        let Some(name) = name else {
            return StatusCode::NOT_FOUND.into_response();
        };
        match self.host(&name).await {
            Ok(host) => host.file(method, path).await,
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
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
    fn a_url_is_a_path_so_any_host_or_tunnel_carries_it() {
        assert_eq!(
            app_url("abc", "pages/index.html"),
            "/a/abc/pages/index.html"
        );
    }
}
