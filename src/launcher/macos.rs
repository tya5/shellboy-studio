use super::{Action, Control, Status};
use crate::{
    auth::{Auth, random_hex},
    owner::{IpcOwner, Owner},
};
use serde::{Deserialize, Serialize};
use shellboy::{
    app::OwnerLock,
    config::{Config, PathEnvironment},
    protocol::{Command, ErrorCode, ThreadListArgs},
};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    os::unix::{ffi::OsStringExt, fs::OpenOptionsExt, process::CommandExt},
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
    actions: mpsc::Receiver<Action>,
    status: watch::Sender<Status>,
}

impl Drop for Launch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.marker);
    }
}

impl Launch {
    pub async fn prepare(dir: &Path, cwd: &Path) -> Result<Option<Self>, String> {
        fs::create_dir_all(dir).map_err(io)?;
        let lock = launcher_lock(dir, "running.lock")?;
        match lock.try_lock() {
            Ok(()) => {}
            Err(std::fs::TryLockError::WouldBlock) => return Ok(None),
            Err(std::fs::TryLockError::Error(error)) => return Err(io(error)),
        }
        let marker_path = dir.join("running.json");
        let bundled = std::env::current_exe()
            .map_err(io)?
            .parent()
            .and_then(Path::parent)
            .ok_or("Studio is not in its application bundle")?
            .join("Resources/bin/shellboy");
        if !bundled.is_file() {
            return Err("Bundled Shellboy is missing".into());
        }
        let listener = match TcpListener::bind("127.0.0.1:8751").await {
            Ok(listener) => listener,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                TcpListener::bind("127.0.0.1:0").await.map_err(io)?
            }
            Err(e) => return Err(io(e)),
        };
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
            started: process_start(pid)
                .await
                .ok_or("Cannot identify the Studio process")?,
            address,
            token_file: dir.join("token"),
            identity: identity.clone(),
        };
        let temporary = dir.join(format!(".running-{identity}"));
        let write = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            serde_json::to_writer(&mut file, &marker)?;
            file.flush()?;
            fs::rename(&temporary, &marker_path)
        })();
        if write.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write.map_err(io)?;
        let (send, actions) = mpsc::channel(1);
        let (status, receiver) = watch::channel(Status {
            reason: None,
            can_restart: false,
        });
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
                status: receiver,
                actions: send,
                marker: identity,
            },
            marker: marker_path,
            _lock: lock,
            owner,
            actions,
            status,
        }))
    }

    pub async fn supervise(&mut self, cancel: CancellationToken) {
        self.start().await;
        loop {
            let child = &mut self.owner.child;
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                action = self.actions.recv() => match action {
                    Some(Action::Exit) | None => break,
                    Some(Action::Restart) if self.status.borrow().can_restart => self.start().await,
                    Some(Action::Restart) => {},
                },
                result = async { match child { Some(p) => p.wait().await, None => std::future::pending().await } } => {
                    self.owner.child = None;
                    let reason = match result { Ok(status) => format!("Bundled owner stopped ({status}). See owner.log."), Err(e) => format!("Owner wait failed: {e}") };
                    self.status.send_replace(Status { reason: Some(reason), can_restart: true });
                }
            }
        }
        cancel.cancel();
        if let Some(mut child) = self.owner.child.take() {
            if let Some(pid) = child.id() {
                // The unreaped child owns this PID; never signal a PID read from a file.
                let _ = Process::new("/bin/kill")
                    .args(["-TERM", &pid.to_string()])
                    .status()
                    .await;
            }
            if timeout(Duration::from_secs(15), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
        }
    }

    async fn start(&mut self) {
        let result = self.owner.start().await;
        self.status.send_replace(match result {
            Ok(reason) => Status {
                reason,
                can_restart: false,
            },
            Err(reason) => Status {
                reason: Some(reason),
                can_restart: true,
            },
        });
    }
}

struct ManagedOwner {
    bundled: PathBuf,
    config: PathBuf,
    cwd: PathBuf,
    log: PathBuf,
    data: PathBuf,
    env: Option<(Vec<(OsString, OsString)>, Option<String>)>,
    child: Option<Child>,
}

impl ManagedOwner {
    async fn start(&mut self) -> Result<Option<String>, String> {
        let owner = IpcOwner::new(self.data.clone());
        let result = owner
            .call(
                Command::ThreadList(ThreadListArgs {
                    limit: 1,
                    ..Default::default()
                }),
                None,
                None,
            )
            .await;
        match result {
            Ok(_) => return Ok(None),
            Err(e) if e.code == ErrorCode::AppNotRunning => {}
            Err(e) => return Err(e.message),
        }
        // AppNotRunning includes transport failures. Only Core's own startup lock
        // can prove there is no live writer; serve retakes it before opening data.
        let directory = self.data.clone();
        tokio::task::spawn_blocking(move || OwnerLock::acquire(&directory).map(drop))
            .await
            .map_err(io)?
            .map_err(|e| e.message)?;
        if self.env.is_none() {
            self.env = Some(login_env(self.bundled.parent().unwrap()).await);
        }
        let (env, warning) = self.env.as_ref().unwrap();
        let process = || {
            let mut command = Process::new(&self.bundled);
            command
                .env_clear()
                .envs(env.iter().cloned())
                .arg("--config")
                .arg(&self.config)
                .current_dir(&self.cwd)
                .stdin(Stdio::null())
                .kill_on_drop(true);
            command
        };
        let log = || {
            OpenOptions::new()
                .append(true)
                .create(true)
                .mode(0o600)
                .custom_flags(O_NOFOLLOW)
                .open(&self.log)
                .map_err(io)
        };
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
        Ok(warning.clone())
    }
}

fn io(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn decode_env(bytes: &[u8], marker: &[u8]) -> Option<Vec<(OsString, OsString)>> {
    let offset = bytes.windows(marker.len()).position(|w| w == marker)? + marker.len();
    let entries = bytes.get(offset..)?.strip_suffix(&[0])?;
    let mut env = Vec::new();
    for entry in entries.split(|&b| b == 0) {
        let split = entry.iter().position(|&b| b == b'=')?;
        if split == 0 {
            return None;
        }
        env.push((
            OsString::from_vec(entry[..split].to_vec()),
            OsString::from_vec(entry[split + 1..].to_vec()),
        ));
    }
    Some(env)
}

async fn login_env(bin: &Path) -> (Vec<(OsString, OsString)>, Option<String>) {
    let result = async {
        let shell = std::env::var_os("SHELL")?;
        if !Path::new(&shell).is_absolute() {
            return None;
        }
        let marker = random_hex().ok()?;
        let mut child = Process::new(shell)
            .arg("-lic")
            .arg(format!("printf '%s' '{marker}'; exec /usr/bin/env -0"))
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .ok()?;
        let mut bytes = Vec::new();
        child
            .stdout
            .take()?
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .ok()?;
        if bytes.len() > 1024 * 1024 || !child.wait().await.ok()?.success() {
            return None;
        }
        decode_env(&bytes, marker.as_bytes())
    };
    let captured = timeout(Duration::from_secs(5), result).await.ok().flatten();
    let warning = captured.is_none().then(|| {
        "Could not capture the login-shell environment; using a minimal environment.".into()
    });
    let mut env = captured.unwrap_or_else(|| {
        ["HOME", "USER", "LOGNAME", "TMPDIR"]
            .into_iter()
            .filter_map(|key| std::env::var_os(key).map(|v| (key.into(), v)))
            .collect()
    });
    let path = env
        .iter()
        .rev()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    env.retain(|(key, _)| {
        !["PATH", "SHELLBOY_DATA_DIR", "SHELLBOY_CONFIG"]
            .iter()
            .any(|name| key == *name)
    });
    let mut path_with_core = bin.as_os_str().to_os_string();
    path_with_core.push(":");
    path_with_core.push(path);
    env.push(("PATH".into(), path_with_core));
    (env, warning)
}

fn launcher_lock(dir: &Path, name: &str) -> Result<File, String> {
    // Darwin O_NOFOLLOW; never open a symlink as a lock or log.
    OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(O_NOFOLLOW)
        .open(dir.join(name))
        .map_err(io)
}

const O_NOFOLLOW: i32 = 0x100;

pub async fn open_or_start(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(io)?;
    let guard = launcher_lock(dir, "launcher.lock")?;
    // Serializes Finder launchers, not the separate server's lifetime.
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
            let log = || {
                OpenOptions::new()
                    .append(true)
                    .create(true)
                    .mode(0o600)
                    .custom_flags(O_NOFOLLOW)
                    .open(dir.join("studio.log"))
            };
            let mut command = std::process::Command::new(std::env::current_exe().map_err(io)?);
            command
                .arg("bundle-server")
                .process_group(0)
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
        if let Some(marker) = read_marker(&dir.join("running.json"), dir) {
            if process_start(marker.pid).await.as_deref() == Some(&marker.started)
                && endpoint_matches(&marker).await
            {
                return open(marker.address, &Auth::load_or_create(dir)?).await;
            }
        }
        if let Some(child) = &mut child {
            if let Some(status) = child.try_wait().map_err(io)? {
                return Err(format!("Studio server stopped ({status}). See studio.log."));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Studio server could not be verified. See studio.log.".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn read_marker(path: &Path, dir: &Path) -> Option<Marker> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(O_NOFOLLOW | 0x4)
        .open(path)
        .ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
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

async fn process_start(pid: u32) -> Option<String> {
    let out = timeout(
        Duration::from_secs(1),
        Process::new("/bin/ps")
            .args(["-o", "lstart=", "-p", &pid.to_string()])
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|s| !s.is_empty())
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

async fn open(addr: SocketAddr, auth: &Auth) -> Result<(), String> {
    let status = Process::new("/usr/bin/open")
        .arg(format!("http://{addr}/#token={}", auth.token()))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(io)?;
    if !status.success() {
        return Err("Could not open Studio in the default browser".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_framing_ignores_shell_banners_and_preserves_newlines() {
        let env = decode_env(
            b"startup output\nRANDOM_PATH=/bin\0VALUE=a\nb=c\0",
            b"RANDOM_",
        )
        .unwrap();
        assert_eq!(
            env,
            vec![
                ("PATH".into(), "/bin".into()),
                ("VALUE".into(), "a\nb=c".into())
            ]
        );
        assert!(decode_env(b"RANDOM_PATH=/bin", b"RANDOM_").is_none());
        assert!(decode_env(b"banner\nPATH=/bin\0", b"RANDOM_").is_none());
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
