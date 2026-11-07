//! Apps: small web apps in folders, hosted by the gateway. Each opens on its own origin, reaches
//! Shellboy only through the API served here, and never sees the Web UI's token. See `docs/design/apps.md`.
//!
//! Bounds (limits, not performance claims): `catalog::MAX_APPS` listed and hosted; one listener per
//! opened app, bound on first open and ended on shutdown; 16 sessions and 16 live tickets per app;
//! `RUNS` scripts at once and one per action; owner calls share the bridge's global semaphore; one hub
//! session per app that uses `thread.onChange`; one `data/` watcher task per app while a page waits.
pub mod catalog;
mod host;
pub mod run;

use crate::{hub::Hub, owner::Owner};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub use host::{AppHost, COOKIE_PREFIX};

const GUIDE: &str = include_str!("README.md");
const RUNS: usize = 4;
const PORT_FILE: &str = "app-ports.json";

/// The one place that decides an app's origin. A loopback port per app: no name resolution is
/// involved, so it works the same in every engine (`docs/design/apps.md`), and distinct ports are
/// distinct origins. Apps use relative URLs, so changing this touches no app.
pub fn app_origin(request_host: &str, port: u16) -> String {
    let name = match request_host.strip_prefix('[') {
        Some(rest) => format!("[{}]", rest.split(']').next().unwrap_or(rest)),
        None => request_host
            .rsplit_once(':')
            .map_or(request_host, |(n, _)| n)
            .to_owned(),
    };
    format!("http://{name}:{port}")
}

pub struct AppsConfig {
    pub dir: PathBuf,
    /// Where the name-to-port map is kept, so an app keeps its origin across restarts.
    pub state_dir: PathBuf,
    pub listen: SocketAddr,
    pub extra_hosts: Vec<String>,
}

pub struct Apps<O> {
    pub dir: PathBuf,
    state_dir: PathBuf,
    ip: IpAddr,
    base_port: u16,
    pub(crate) listen: SocketAddr,
    pub(crate) extra_hosts: Vec<String>,
    pub(crate) owner: Arc<O>,
    pub(crate) hub: Arc<Hub>,
    pub(crate) global: Arc<Semaphore>,
    pub(crate) runs: Semaphore,
    hosts: tokio::sync::Mutex<HashMap<String, Arc<AppHost<O>>>>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    cancel: CancellationToken,
}

impl<O: Owner> Apps<O> {
    pub fn new(
        config: AppsConfig,
        owner: Arc<O>,
        hub: Arc<Hub>,
        global: Arc<Semaphore>,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        // The guide a model reads. Rewritten each start, so it matches this gateway's API.
        if let Err(e) = std::fs::create_dir_all(&config.dir)
            .and_then(|_| std::fs::write(config.dir.join("README.md"), GUIDE))
        {
            eprintln!(
                "shellboy-web: cannot write the apps guide in {}: {e}",
                config.dir.display()
            );
        }
        Arc::new(Self {
            dir: config.dir,
            state_dir: config.state_dir,
            ip: config.listen.ip(),
            base_port: config.listen.port(),
            listen: config.listen,
            extra_hosts: config.extra_hosts,
            owner,
            hub,
            global,
            runs: Semaphore::new(RUNS),
            hosts: tokio::sync::Mutex::new(HashMap::new()),
            tasks: Mutex::new(Vec::new()),
            cancel,
        })
    }

    pub async fn list(&self) -> Result<Value, String> {
        let apps = catalog::list(&self.dir).await?;
        Ok(json!({"dir": self.dir, "guide": self.dir.join("README.md"), "apps": apps}))
    }

    fn saved_ports(&self) -> BTreeMap<String, u16> {
        std::fs::read(self.state_dir.join(PORT_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn save_port(&self, name: &str, port: u16) {
        let mut ports = self.saved_ports();
        ports.insert(name.to_owned(), port);
        let write = std::fs::create_dir_all(&self.state_dir).and_then(|_| {
            let temp = self.state_dir.join(format!("{PORT_FILE}.tmp"));
            std::fs::write(&temp, serde_json::to_vec(&ports).unwrap_or_default())?;
            std::fs::rename(temp, self.state_dir.join(PORT_FILE))
        });
        if let Err(e) = write {
            eprintln!("shellboy-web: cannot save app ports: {e}");
        }
    }

    /// Its saved port if free, else the first free one after the bridge's own. The range is fixed by `MAX_APPS`.
    async fn bind(&self, name: &str) -> std::io::Result<tokio::net::TcpListener> {
        let saved = self.saved_ports();
        if let Some(port) = saved.get(name)
            && let Ok(listener) = tokio::net::TcpListener::bind((self.ip, *port)).await
        {
            return Ok(listener);
        }
        let taken: Vec<u16> = saved.values().copied().collect();
        let mut last = std::io::Error::other("no free port for this app");
        for offset in 1..=(catalog::MAX_APPS as u16 * 2) {
            let Some(port) = self.base_port.checked_add(offset) else {
                break;
            };
            if taken.contains(&port) {
                continue;
            }
            match tokio::net::TcpListener::bind((self.ip, port)).await {
                Ok(listener) => {
                    self.save_port(name, port);
                    return Ok(listener);
                }
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// A URL that opens the app in this browser: its origin and a ticket that works once.
    pub async fn open(
        self: &Arc<Self>,
        name: &str,
        request_host: &str,
    ) -> Result<Value, (&'static str, String)> {
        let Some(entry) = catalog::read_entry(&self.dir, name).await else {
            return Err(("app_not_found", format!("No app named {name}")));
        };
        if let Some(problem) = entry.problem {
            return Err(("app_broken", problem));
        }
        let mut hosts = self.hosts.lock().await;
        let host = match hosts.get(name) {
            Some(h) => h.clone(),
            None => {
                if hosts.len() >= catalog::MAX_APPS {
                    return Err(("too_many_apps", "Too many apps are open".to_owned()));
                }
                let listener = self
                    .bind(name)
                    .await
                    .map_err(|e| ("app_listen_failed", e.to_string()))?;
                let port = listener
                    .local_addr()
                    .map_err(|e| ("app_listen_failed", e.to_string()))?
                    .port();
                let host = AppHost::new(name.to_owned(), self.dir.join(name), port, self.clone());
                let router = host.clone().router();
                let stop = self.cancel.clone();
                let task = tokio::spawn(async move {
                    let _ = axum::serve(listener, router)
                        .with_graceful_shutdown(async move { stop.cancelled().await })
                        .await;
                });
                self.tasks
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .push(task);
                hosts.insert(name.to_owned(), host.clone());
                host
            }
        };
        let origin = app_origin(request_host, host.port);
        let ticket = host.issue_ticket();
        Ok(
            json!({"name": name, "origin": origin, "url": format!("{origin}/?{}={ticket}", host::TICKET_PARAM), "thread": entry.thread, "title": entry.title}),
        )
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

    /// After `cancel`: wait for the app listeners.
    pub async fn stopped(&self) {
        let tasks = std::mem::take(&mut *self.tasks.lock().unwrap_or_else(|p| p.into_inner()));
        for task in tasks {
            let _ = task.await;
        }
    }

    pub fn guide_path(&self) -> PathBuf {
        Path::new(&self.dir).join("README.md")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_follows_the_host_name_and_the_app_port() {
        assert_eq!(app_origin("127.0.0.1:8751", 8752), "http://127.0.0.1:8752");
        assert_eq!(app_origin("localhost:8751", 8760), "http://localhost:8760");
        assert_eq!(app_origin("[::1]:8751", 8752), "http://[::1]:8752");
        assert_eq!(app_origin("box.example", 8752), "http://box.example:8752");
    }
}
