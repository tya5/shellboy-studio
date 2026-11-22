use super::Control;
#[cfg(target_os = "macos")]
use super::macos as platform;
#[cfg(windows)]
use super::windows as platform;
use crate::{
    auth::{Auth, random_hex},
    owner::{IpcOwner, startup_probe},
};
use serde::{Deserialize, Serialize};
use shellboy::{
    config::{Config, PathEnvironment},
    protocol::ErrorCode,
};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    process::{Child, Command as Process},
    sync::{mpsc, watch},
    time::timeout,
};
use tokio_util::sync::CancellationToken;

const OWNER_FAILURE: &str = "The bundled owner failed. See studio.log and owner.log.";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    version: u8,
    pid: u32,
    started: String,
    address: SocketAddr,
    token_file: PathBuf,
    identity: String,
}

pub struct Launch {
    pub listener: Option<TcpListener>,
    pub data_dir: PathBuf,
    pub auth: Option<Auth>,
    pub control: Control,
    marker: PathBuf,
    _lock: File,
    owner: ManagedOwner,
    restart: mpsc::Receiver<()>,
    diagnostic: watch::Sender<Option<String>>,
}

impl Drop for Launch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.marker);
    }
}

impl Launch {
    pub async fn prepare(dir: &Path, cwd: &Path) -> Result<Option<Self>, String> {
        fs::create_dir_all(dir).map_err(io)?;
        platform::check_directory(dir).map_err(io)?;
        let lock = launcher_lock(dir, "running.lock")?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => return Ok(None),
            Err(std::fs::TryLockError::Error(error)) => return Err(io(error)),
        }
        let marker_path = dir.join("running.json");
        let bundled = platform::bundled_core(&std::env::current_exe().map_err(io)?)?;
        if !bundled.is_file() {
            return Err("Bundled Shellboy is missing".into());
        }
        let listener = bind_loopback(8751).await.map_err(io)?;
        let address = listener.local_addr().map_err(io)?;
        let auth = Auth::load_or_create(dir)?;
        let paths = PathEnvironment::current();
        let config = paths.default_config_path().map_err(|e| e.to_string())?;
        let data_dir = Config::load(None, cwd).map_err(|e| e.to_string())?.data_dir;
        let pid = std::process::id();
        let identity = random_hex()?;
        let marker = Marker {
            version: 1,
            pid,
            started: platform::process_start(pid)
                .await
                .ok_or("Cannot identify the Studio process")?,
            address,
            token_file: dir.join("token"),
            identity: identity.clone(),
        };
        let temporary = dir.join(format!(".running-{identity}"));
        let write = (|| -> std::io::Result<()> {
            let mut file = open_file(
                &temporary,
                OpenOptions::new().write(true).create_new(true),
                true,
            )?;
            serde_json::to_writer(&mut file, &marker)?;
            file.flush()?;
            fs::rename(&temporary, &marker_path)
        })();
        if write.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write.map_err(io)?;
        let (send, restart) = mpsc::channel(1);
        let (diagnostic, receiver) = watch::channel(None);
        let owner = ManagedOwner {
            bundled,
            config,
            cwd: cwd.into(),
            log: dir.join("owner.log"),
            data: data_dir.clone(),
            env: None,
            child: None,
        };
        Ok(Some(Self {
            listener: Some(listener),
            data_dir,
            auth: Some(auth),
            control: Control {
                diagnostic: receiver,
                restart: send,
                marker: identity,
            },
            marker: marker_path,
            _lock: lock,
            owner,
            restart,
            diagnostic,
        }))
    }

    pub async fn supervise(&mut self, cancel: CancellationToken) {
        self.start().await;
        loop {
            let child = &mut self.owner.child;
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                restart = self.restart.recv() => {
                    if restart.is_none() { break; }
                    self.start().await;
                },
                result = async { match child { Some(p) => p.wait().await, None => std::future::pending().await } } => {
                    self.owner.child = None;
                    eprintln!("shellboy-studio: bundled owner exited: {result:?}");
                    if !result.is_ok_and(|status| status.success()) {
                        self.diagnostic.send_replace(Some(OWNER_FAILURE.into()));
                    }
                }
            }
        }
        cancel.cancel();
        platform::stop_child(self.owner.child.take()).await;
    }

    async fn start(&mut self) {
        self.diagnostic
            .send_replace(match self.owner.start().await {
                Ok(warning) => warning,
                Err(reason) => {
                    eprintln!("shellboy-studio: bundled owner start refused or failed: {reason}");
                    Some(OWNER_FAILURE.into())
                }
            });
    }
}

pub(super) struct OwnerEnvironment {
    pub(super) vars: Vec<(OsString, OsString)>,
    pub(super) warning: Option<String>,
}

struct ManagedOwner {
    bundled: PathBuf,
    config: PathBuf,
    cwd: PathBuf,
    log: PathBuf,
    data: PathBuf,
    env: Option<OwnerEnvironment>,
    child: Option<Child>,
}

impl ManagedOwner {
    async fn start(&mut self) -> Result<Option<String>, String> {
        let owner = IpcOwner::new(self.data.clone());
        match startup_probe(&owner).await {
            Ok(()) => return Ok(None),
            Err(e) if e.code == ErrorCode::AppNotRunning => {}
            Err(e) => return Err(e.message),
        }
        if let Some(child) = &mut self.child {
            if child.try_wait().map_err(io)?.is_none() {
                return Err("The existing bundled process has not exited".into());
            }
            self.child = None;
        }
        if self.env.is_none() {
            self.env = Some(
                platform::owner_environment(self.bundled.parent().expect("bundled Core directory"))
                    .await?,
            );
        }
        let env = self.env.as_ref().expect("captured environment");
        let process = || {
            let mut command = Process::new(&self.bundled);
            platform::configure_owner(&mut command, env);
            command
                .arg("--config")
                .arg(&self.config)
                .current_dir(&self.cwd)
                .stdin(Stdio::null())
                .kill_on_drop(true);
            command
        };
        let log = || open_log(&self.log).map_err(io);
        match fs::symlink_metadata(&self.config) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let result = timeout(
                    Duration::from_secs(10),
                    process()
                        .args(["config", "init"])
                        .stdout(log()?)
                        .stderr(log()?)
                        .status(),
                )
                .await
                .map_err(|_| "Core config initialization timed out")?
                .map_err(io)?;
                if !result.success() {
                    return Err("Core config initialization failed. See owner.log.".into());
                }
            }
            Err(e) => return Err(io(e)),
        }
        self.child = Some(
            process()
                .arg("serve")
                .arg("--data-dir")
                .arg(&self.data)
                .stdout(log()?)
                .stderr(log()?)
                .spawn()
                .map_err(io)?,
        );
        Ok(env.warning.clone())
    }
}

pub(super) fn io(error: impl std::fmt::Display) -> String {
    error.to_string()
}

async fn bind_loopback(port: u16) -> std::io::Result<TcpListener> {
    match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await {
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            TcpListener::bind("127.0.0.1:0").await
        }
        result => result,
    }
}

fn open_file(path: &Path, options: &mut OpenOptions, private: bool) -> std::io::Result<File> {
    platform::protect_file(options, private);
    let file = options.open(path)?;
    platform::check_file(&file)?;
    Ok(file)
}

fn open_log(path: &Path) -> std::io::Result<File> {
    open_file(path, OpenOptions::new().append(true).create(true), true)
}

fn launcher_lock(dir: &Path, name: &str) -> Result<File, String> {
    open_file(
        &dir.join(name),
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true),
        true,
    )
    .map_err(io)
}

pub async fn open_or_start(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(io)?;
    platform::check_directory(dir).map_err(io)?;
    let guard = launcher_lock(dir, "launcher.lock")?;
    // Serializes desktop launchers, not the separate server's lifetime.
    let _guard = tokio::task::spawn_blocking(move || {
        guard.lock()?;
        Ok::<_, std::io::Error>(guard)
    })
    .await
    .map_err(io)?
    .map_err(io)?;
    let running = launcher_lock(dir, "running.lock")?;
    let mut child = match running.try_lock() {
        Ok(()) => {
            fs::remove_file(dir.join("running.json"))
                .or_else(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })
                .map_err(io)?;
            drop(running);
            let log = || open_log(&dir.join("studio.log"));
            let mut command = std::process::Command::new(std::env::current_exe().map_err(io)?);
            platform::detach(&mut command);
            command
                .arg("bundle-server")
                .stdin(Stdio::null())
                .stdout(log().map_err(io)?)
                .stderr(log().map_err(io)?);
            Some(command.spawn().map_err(io)?)
        }
        Err(std::fs::TryLockError::WouldBlock) => None,
        Err(std::fs::TryLockError::Error(error)) => return Err(io(error)),
    };
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(marker) = read_marker(&dir.join("running.json"), dir)
            && platform::process_start(marker.pid).await.as_deref() == Some(&marker.started)
            && endpoint_matches(&marker).await
        {
            let auth = Auth::load_or_create(dir)?;
            return platform::open_browser(&format!(
                "http://{}/#token={}",
                marker.address,
                auth.token()
            ))
            .await;
        }
        if let Some(child) = &mut child
            && let Some(status) = child.try_wait().map_err(io)?
        {
            return Err(format!("Studio server stopped ({status}). See studio.log."));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Studio server could not be verified. See studio.log.".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn read_marker(path: &Path, dir: &Path) -> Option<Marker> {
    let file = open_file(path, OpenOptions::new().read(true), false).ok()?;
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes).ok()?;
    let marker: Marker = serde_json::from_slice(&bytes).ok()?;
    (bytes.len() <= 4096
        && marker.version == 1
        && marker.pid > 0
        && marker.address.ip().is_loopback()
        && marker.address.port() != 0
        && marker.token_file == dir.join("token")
        && marker.identity.len() == 64
        && marker.identity.bytes().all(|b| b.is_ascii_hexdigit()))
    .then_some(marker)
}

async fn endpoint_matches(marker: &Marker) -> bool {
    timeout(Duration::from_secs(1), async {
        let mut stream = TcpStream::connect(marker.address).await?;
        stream
            .write_all(
                format!("GET /healthz HTTP/1.0\r\nHost: {}\r\n\r\n", marker.address).as_bytes(),
            )
            .await?;
        let mut bytes = Vec::new();
        stream.take(4096).read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(
            String::from_utf8_lossy(&bytes)
                .split_once("\r\n\r\n")
                .is_some_and(|(head, body)| {
                    head.starts_with("HTTP/1.0 200 ") && body == marker.identity
                }),
        )
    })
    .await
    .is_ok_and(|result| result.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "subprocess fixture only"]
    fn child_fixture() {
        std::thread::sleep(Duration::from_secs(30));
    }

    #[tokio::test]
    async fn shutdown_only_signals_the_owned_child() {
        fn sleeper() -> Child {
            Process::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "launcher::desktop::tests::child_fixture",
                    "--ignored",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .unwrap()
        }
        let mut unrelated = sleeper();
        platform::stop_child(None).await;
        assert!(unrelated.try_wait().unwrap().is_none());
        let owned = sleeper();
        let pid = owned.id().unwrap();
        assert!(platform::process_start(pid).await.is_some());
        platform::stop_child(Some(owned)).await;
        assert!(platform::process_start(pid).await.is_none());
        assert!(unrelated.try_wait().unwrap().is_none());
        unrelated.kill().await.unwrap();
    }

    #[tokio::test]
    async fn occupied_loopback_port_falls_back() {
        let first = bind_loopback(0).await.unwrap();
        let second = bind_loopback(first.local_addr().unwrap().port())
            .await
            .unwrap();
        assert!(second.local_addr().unwrap().ip().is_loopback());
        assert_ne!(first.local_addr().unwrap(), second.local_addr().unwrap());
    }

    #[test]
    fn launcher_and_server_locks_serialize_separately_and_release() {
        let dir = std::env::temp_dir().join(format!("studio-locks-{}", random_hex().unwrap()));
        fs::create_dir(&dir).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(dir.clone());
        let launcher = launcher_lock(&dir, "launcher.lock").unwrap();
        launcher.lock().unwrap();
        let server = launcher_lock(&dir, "running.lock").unwrap();
        server.try_lock().unwrap();
        let contender = launcher_lock(&dir, "launcher.lock").unwrap();
        assert!(matches!(
            contender.try_lock(),
            Err(std::fs::TryLockError::WouldBlock)
        ));
        drop(launcher);
        contender.lock().unwrap();
        let running = launcher_lock(&dir, "running.lock").unwrap();
        assert!(matches!(
            running.try_lock(),
            Err(std::fs::TryLockError::WouldBlock)
        ));
        drop(server);
        running.try_lock().unwrap();
    }

    #[tokio::test]
    async fn marker_requires_exact_live_studio_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                axum::Router::new().route(
                    "/healthz",
                    axum::routing::get(|| async { "fixture-identity" }),
                ),
            )
            .await
            .unwrap();
        });
        let mut marker = Marker {
            version: 1,
            pid: std::process::id(),
            started: String::new(),
            address,
            token_file: PathBuf::from("token"),
            identity: "wrong".into(),
        };
        assert!(!endpoint_matches(&marker).await);
        marker.identity = "fixture-identity".into();
        assert!(endpoint_matches(&marker).await);
        server.abort();
        let _ = server.await;
    }
}
