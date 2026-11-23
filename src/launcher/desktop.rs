#[cfg(target_os = "macos")]
use super::macos as platform;
#[cfg(windows)]
use super::windows as platform;
use super::{
    Control,
    startup::{self, Refusal},
};
use crate::{
    auth::{Auth, random_hex},
    owner::{IpcOwner, Owner},
};
use serde::{Deserialize, Serialize};
use shellboy::config::{Config, PathEnvironment, resolve_config_path};
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

const OWNER_START_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    version: u8,
    pid: u32,
    started: String,
    address: SocketAddr,
    token_file: PathBuf,
    identity: String,
    data_dir: PathBuf,
}

/// The desktop options, with Core's meaning: `--config PATH` and `--data-dir PATH`.
#[derive(clap::Parser, Debug, Default)]
pub struct PathArgs {
    #[arg(long)]
    pub config: Option<PathBuf>,
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
}

impl PathArgs {
    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Result<Self, String> {
        <Self as clap::Parser>::try_parse_from(
            std::iter::once(OsString::from("shellboy-studio")).chain(args),
        )
        .map_err(|_| "Studio accepts only --config PATH and --data-dir PATH.".into())
    }
}

/// The Core config file and owner data directory one desktop Studio uses.
#[derive(Clone, Debug, PartialEq)]
pub struct CorePaths {
    pub config: PathBuf,
    pub data_dir: PathBuf,
}

impl CorePaths {
    /// Core's precedence (config: argument > OS default; data directory: argument >
    /// SHELLBOY_DATA_DIR > config `data_dir` > OS default); relative arguments resolve
    /// against `cwd`. Reads the config file.
    pub fn resolve(args: &PathArgs, cwd: &Path, env: &PathEnvironment) -> Result<Self, String> {
        let unusable = |e: shellboy::config::ConfigError| {
            format!("Cannot use the Shellboy config or data directory: {e}")
        };
        Ok(Self {
            config: resolve_config_path(args.config.as_deref(), cwd, env).map_err(unusable)?,
            data_dir: Config::load_with_overrides(
                args.config.as_deref(),
                args.data_dir.as_deref(),
                cwd,
                env,
            )
            .map_err(unusable)?
            .data_dir,
        })
    }

    /// The bundle server uses the pair its launcher resolved, as given.
    pub fn resolved(args: PathArgs) -> Result<Self, String> {
        match (args.config, args.data_dir) {
            (Some(config), Some(data_dir)) if config.is_absolute() && data_dir.is_absolute() => {
                Ok(Self { config, data_dir })
            }
            _ => Err("The bundle server needs absolute --config and --data-dir".into()),
        }
    }

    fn server_args(&self) -> [OsString; 5] {
        [
            "bundle-server".into(),
            "--config".into(),
            self.config.clone().into(),
            "--data-dir".into(),
            self.data_dir.clone().into(),
        ]
    }
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
    crashes: std::collections::VecDeque<String>,
}

impl Drop for Launch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.marker);
    }
}

impl Launch {
    pub async fn prepare(dir: &Path, cwd: &Path, paths: CorePaths) -> Result<Option<Self>, String> {
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
        let CorePaths { config, data_dir } = paths;
        let pid = std::process::id();
        let identity = random_hex()?;
        let marker = Marker {
            version: 2,
            pid,
            started: platform::process_start(pid)
                .await
                .ok_or("Cannot identify the Studio process")?,
            address,
            token_file: dir.join("token"),
            identity: identity.clone(),
            data_dir: data_dir.clone(),
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
            ready: watch::channel(false).1,
            output: None,
            start_log_offset: 0,
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
            crashes: std::collections::VecDeque::new(),
        }))
    }

    pub async fn supervise(&mut self, cancel: CancellationToken) {
        use crate::launcher::supervisor::{ChildExit, Decision, RestartState};
        let cap = OWNER_START_TIMEOUT;
        let mut restart_state = RestartState::new(cap);
        self.start().await;
        loop {
            if self.owner.child.is_none() {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    restart = self.restart.recv() => {
                        if restart.is_none() { break; }
                        self.start().await;
                    }
                }
                continue;
            }
            let mut ready = false;
            let mut ready_closed = false;
            let exit = loop {
                let child = &mut self.owner.child;
                let ready_signal = &mut self.owner.ready;
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break None,
                    restart = self.restart.recv() => {
                        if restart.is_none() { break None; }
                        self.start().await;
                    },
                    result = async { match child { Some(p) => p.wait().await, None => std::future::pending().await } } => {
                        self.owner.child = None;
                        break Some(result);
                    },
                    changed = ready_signal.changed(), if !ready && !ready_closed => {
                        if changed.is_ok() {
                            if *ready_signal.borrow_and_update() {
                                ready = true;
                                self.crashes.clear();
                                let warning = self.owner.env.as_ref().and_then(|env| env.warning.clone());
                                self.diagnostic.send_replace(warning);
                            }
                        } else {
                            ready_closed = true;
                        }
                    },
                }
            };
            let Some(result) = exit else { break };
            if let Some(output) = self.owner.output.take() {
                let _ = output.await;
            }
            ready |= *self.owner.ready.borrow();
            let status = result.ok();
            let clean = status
                .as_ref()
                .is_some_and(std::process::ExitStatus::success);
            let reason = if !ready {
                self.owner
                    .startup_failure()
                    .or_else(|| status.map(|s| format!("Core exited before ready with {s}")))
                    .unwrap_or_else(|| "Core child wait failed before ready".into())
            } else {
                status
                    .map(|s| format!("Core exited with {s}"))
                    .unwrap_or_else(|| "Core child wait failed".into())
            };
            let decision = restart_state.exited(
                ready,
                if clean {
                    ChildExit::Clean
                } else if ready {
                    ChildExit::Crash(reason)
                } else {
                    ChildExit::BeforeReady(reason)
                },
            );
            match decision {
                Decision::Stop => continue,
                Decision::ShowFailure(reason) => {
                    self.publish_crash(reason);
                    continue;
                }
                Decision::Retry { reason, after } => {
                    self.publish_crash(format!(
                        "Core crashed after ready ({reason}); restarting in {}s",
                        after.as_secs()
                    ));
                    tokio::select! {
                        biased;
                        _ = cancel.cancelled() => break,
                        restart = self.restart.recv() => {
                            if restart.is_none() { break; }
                        },
                        _ = tokio::time::sleep(after) => {}
                    }
                    self.start().await;
                }
            }
        }
        platform::stop_child(self.owner.child.take()).await;
        if let Some(output) = self.owner.output.take() {
            let _ = output.await;
        }
    }

    fn publish_crash(&mut self, message: String) {
        const HISTORY: usize = 20;
        self.crashes.push_back(message);
        if self.crashes.len() > HISTORY {
            self.crashes.pop_front();
        }
        self.diagnostic.send_replace(Some(
            self.crashes.iter().cloned().collect::<Vec<_>>().join("\n"),
        ));
    }

    async fn start(&mut self) {
        match self.owner.start().await {
            Ok(warning) => {
                self.crashes.clear();
                self.diagnostic.send_replace(warning);
            }
            Err(reason) => {
                eprintln!(
                    "shellboy-studio: bundled owner start refused or failed: {}",
                    reason.reason
                );
                self.publish_crash(reason.message().into());
            }
        }
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
    ready: watch::Receiver<bool>,
    output: Option<tokio::task::JoinHandle<()>>,
    start_log_offset: u64,
}

impl ManagedOwner {
    fn startup_failure(&self) -> Option<String> {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = File::open(&self.log).ok()?;
        let length = file.metadata().ok()?.len();
        const TAIL: u64 = 16 * 1024;
        let start = self
            .start_log_offset
            .min(length)
            .max(length.saturating_sub(TAIL));
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut bytes = Vec::with_capacity((length - start) as usize);
        file.take(length - start).read_to_end(&mut bytes).ok()?;
        bytes
            .split(|byte| *byte == b'\n')
            .rev()
            .find_map(super::supervisor::startup_error_line)
    }

    async fn start(&mut self) -> Result<Option<String>, Refusal> {
        let owner = IpcOwner::new(self.data.clone());
        self.start_with(&owner, |mut command| command.spawn().map_err(io))
            .await
    }

    async fn start_with(
        &mut self,
        owner: &impl Owner,
        spawn: impl FnOnce(Process) -> Result<Child, String>,
    ) -> Result<Option<String>, Refusal> {
        if startup::probe(owner).await? {
            return Ok(None);
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
            Err(e) => return Err(io(e).into()),
        }
        let mut command = process();
        command
            .arg("serve")
            .arg("--data-dir")
            .arg(&self.data)
            .stdout(Stdio::piped())
            .stderr(log()?);
        self.start_log_offset = fs::metadata(&self.log)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut child = spawn(command)?;
        let (ready_tx, ready_rx) = watch::channel(false);
        self.ready = ready_rx;
        self.output = child.stdout.take().map(|stdout| {
            let log_path = self.log.clone();
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let Ok(mut log) = tokio::fs::OpenOptions::new()
                    .append(true)
                    .open(log_path)
                    .await
                else {
                    return;
                };
                let mut source = stdout;
                let mut chunk = [0_u8; 4096];
                let mut line = Vec::with_capacity(1024);
                let mut oversized = false;
                loop {
                    let count = match source.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(count) => count,
                    };
                    if log.write_all(&chunk[..count]).await.is_err() {
                        break;
                    }
                    for byte in &chunk[..count] {
                        if *byte == b'\n' {
                            if !oversized && super::supervisor::is_ready_line(&line) {
                                ready_tx.send_replace(true);
                            }
                            line.clear();
                            oversized = false;
                        } else if !oversized {
                            if line.len() < 8192 {
                                line.push(*byte);
                            } else {
                                line.clear();
                                oversized = true;
                            }
                        }
                    }
                }
                let _ = log.flush().await;
            })
        });
        self.child = Some(child);
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

pub async fn open_or_start(dir: &Path, args: PathArgs) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(io)?;
    let paths = CorePaths::resolve(&args, &cwd, &PathEnvironment::current())?;
    open_or_start_with(
        dir,
        &paths.data_dir,
        || {
            let log = || open_log(&dir.join("studio.log"));
            let mut command = std::process::Command::new(std::env::current_exe().map_err(io)?);
            platform::detach(&mut command);
            command
                .args(paths.server_args())
                .stdin(Stdio::null())
                .stdout(log().map_err(io)?)
                .stderr(log().map_err(io)?);
            command.spawn().map(Some).map_err(io)
        },
        |url| async move { platform::open_browser(&url).await },
    )
    .await
}

async fn open_or_start_with<F: std::future::Future<Output = Result<(), String>>>(
    dir: &Path,
    data_dir: &Path,
    spawn: impl FnOnce() -> Result<Option<std::process::Child>, String>,
    open: impl FnOnce(String) -> F,
) -> Result<(), String> {
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
            spawn()?
        }
        Err(std::fs::TryLockError::WouldBlock) => None,
        Err(std::fs::TryLockError::Error(error)) => return Err(io(error)),
    };
    let deadline = tokio::time::Instant::now() + OWNER_START_TIMEOUT;
    loop {
        if let Some(marker) = read_marker(&dir.join("running.json"), dir)
            && platform::process_start(marker.pid).await.as_deref() == Some(&marker.started)
            && endpoint_matches(&marker).await
        {
            // One Studio per user: never switch a running Studio to another data directory.
            if !same_dir(&marker.data_dir, data_dir) {
                return Err(format!(
                    "Studio is already running with another data directory.\n\nRunning: {}\nRequested: {}\n\nUse Exit in the running Studio, then open it again.",
                    marker.data_dir.display(),
                    data_dir.display()
                ));
            }
            let auth = Auth::load_or_create(dir)?;
            return open(format!("http://{}/#token={}", marker.address, auth.token())).await;
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

/// Same directory, even when spelled differently (case, `..`, relative base).
/// The canonical form is only compared, never stored or shown.
fn same_dir(running: &Path, requested: &Path) -> bool {
    running == requested
        || matches!(
            (fs::canonicalize(running), fs::canonicalize(requested)),
            (Ok(a), Ok(b)) if a == b
        )
}

fn read_marker(path: &Path, dir: &Path) -> Option<Marker> {
    let file = open_file(path, OpenOptions::new().read(true), false).ok()?;
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes).ok()?;
    let marker: Marker = serde_json::from_slice(&bytes).ok()?;
    (bytes.len() <= 4096
        && marker.version == 2
        && marker.pid > 0
        && marker.data_dir.is_absolute()
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

    #[test]
    #[ignore = "subprocess fixture only"]
    fn fake_core_child() {
        match std::env::var("STUDIO_FAKE_CORE_MODE").as_deref() {
            Ok("ready-crash") => {
                println!(r#"{{"event":"ready","state":"ready"}}"#);
                std::io::stdout().flush().unwrap();
                std::process::exit(1);
            }
            Ok("startup-error") => {
                eprintln!(
                    r#"{{"ok":false,"error":{{"message":"bad config","hint":"repair the config"}}}}"#
                );
                std::process::exit(1);
            }
            mode => panic!("unexpected fake child mode: {mode:?}"),
        }
    }

    async fn fake_core(owner: &mut ManagedOwner, mode: &str) -> std::process::ExitStatus {
        use shellboy::protocol::{ApiError, Command, ErrorCode, Origin, Response};
        struct Probe;
        impl Owner for Probe {
            async fn call(
                &self,
                _: Command,
                _: Option<String>,
                _: Option<Origin>,
            ) -> Result<Response<serde_json::Value>, ApiError> {
                Err(ApiError::new(ErrorCode::AppNotRunning, "fixture offline"))
            }
        }
        let log_path = owner.log.clone();
        owner
            .start_with(&Probe, move |_| {
                let stderr = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .unwrap();
                let mut command = Process::new(std::env::current_exe().unwrap());
                command
                    .args([
                        "--exact",
                        "launcher::desktop::tests::fake_core_child",
                        "--ignored",
                        "--nocapture",
                    ])
                    .env("STUDIO_FAKE_CORE_MODE", mode)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped());
                command.as_std_mut().stderr(Stdio::from(stderr));
                command.spawn().map_err(io)
            })
            .await
            .unwrap();
        let status = owner.child.as_mut().unwrap().wait().await.unwrap();
        if let Some(output) = owner.output.take() {
            output.await.unwrap();
        }
        status
    }

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
    #[tokio::test]
    async fn shutdown_only_signals_the_owned_child() {
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

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("studio-desktop-{}", random_hex().unwrap()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn reachable_owner_is_not_owned_and_absent_owner_spawns_once() {
        use shellboy::protocol::{ApiError, Command, ErrorCode, Origin, Response};
        struct Probe(bool);
        impl Owner for Probe {
            async fn call(
                &self,
                command: Command,
                _: Option<String>,
                _: Option<Origin>,
            ) -> Result<Response<serde_json::Value>, ApiError> {
                assert!(matches!(command, Command::ThreadList(_)));
                if self.0 {
                    Ok(Response::success("fixture", serde_json::json!({})))
                } else {
                    Err(ApiError::new(ErrorCode::AppNotRunning, "fixture offline"))
                }
            }
        }
        // A custom (non-default) pair, as a TUI owner elsewhere would use it.
        let dir = Temp::new();
        let custom = dir.0.join("work");
        fs::create_dir_all(custom.join("data")).unwrap();
        let config = custom.join("config.toml");
        fs::write(&config, "").unwrap();
        let data = custom.join("data");
        let mut owner = ManagedOwner {
            bundled: dir.0.join("fixture-core"),
            config: config.clone(),
            cwd: dir.0.clone(),
            log: dir.0.join("owner.log"),
            data: data.clone(),
            env: Some(OwnerEnvironment {
                vars: vec![],
                warning: None,
            }),
            child: None,
            ready: watch::channel(false).1,
            output: None,
            start_log_offset: 0,
        };
        let mut external = sleeper();
        owner
            .start_with(&Probe(true), |_| panic!("reachable owner must not spawn"))
            .await
            .unwrap();
        assert!(owner.child.is_none(), "attached, not owned");
        platform::stop_child(owner.child.take()).await;
        assert!(external.try_wait().unwrap().is_none());
        owner
            .start_with(&Probe(false), |command| {
                let args: Vec<_> = command.as_std().get_args().collect();
                assert_eq!(
                    args,
                    [
                        "--config".as_ref(),
                        config.as_os_str(),
                        "serve".as_ref(),
                        "--data-dir".as_ref(),
                        data.as_os_str()
                    ]
                );
                Ok(sleeper())
            })
            .await
            .unwrap();
        let pid = owner.child.as_ref().unwrap().id().unwrap();
        assert!(
            owner
                .start_with(&Probe(false), |_| panic!(
                    "unreaped child must not spawn again"
                ))
                .await
                .is_err()
        );
        owner
            .start_with(&Probe(true), |_| {
                panic!("reachable owner must not spawn again")
            })
            .await
            .unwrap();
        assert_eq!(owner.child.as_ref().unwrap().id(), Some(pid));
        platform::stop_child(owner.child.take()).await;
        assert!(external.try_wait().unwrap().is_none());
        external.kill().await.unwrap();
    }

    #[tokio::test]
    async fn fake_child_ready_crash_retries_and_pre_ready_error_stops_with_typed_reason() {
        use crate::launcher::supervisor::{ChildExit, Decision, RestartState};
        let dir = Temp::new();
        let config = dir.0.join("config.toml");
        fs::write(&config, "").unwrap();
        let make_owner = || ManagedOwner {
            bundled: dir.0.join("bin/shellboy"),
            config: config.clone(),
            cwd: dir.0.clone(),
            log: dir.0.join("owner.log"),
            data: dir.0.join("data"),
            env: Some(OwnerEnvironment {
                vars: vec![],
                warning: None,
            }),
            child: None,
            ready: watch::channel(false).1,
            output: None,
            start_log_offset: 0,
        };

        let mut crashing = make_owner();
        let status = fake_core(&mut crashing, "ready-crash").await;
        assert_eq!(status.code(), Some(1));
        assert!(*crashing.ready.borrow());
        let mut state = RestartState::new(OWNER_START_TIMEOUT);
        assert!(matches!(
            state.exited(true, ChildExit::Crash(format!("Core exited with {status}"))),
            Decision::Retry { .. }
        ));

        let mut failing = make_owner();
        let status = fake_core(&mut failing, "startup-error").await;
        assert_eq!(status.code(), Some(1));
        assert!(!*failing.ready.borrow());
        let reason = failing
            .startup_failure()
            .expect("typed startup error from child log");
        assert_eq!(reason, "bad config repair the config");
        assert_eq!(
            state.exited(false, ChildExit::BeforeReady(reason.clone())),
            Decision::ShowFailure(reason)
        );
    }

    #[tokio::test]
    async fn concurrent_opens_reuse_one_verified_authenticated_server() {
        use std::cell::RefCell;
        let dir = Temp::new();
        let path = &dir.0;
        let listener = bind_loopback(0).await.unwrap();
        let address = listener.local_addr().unwrap();
        let listener = RefCell::new(Some(listener));
        let started = platform::process_start(std::process::id()).await.unwrap();
        let token = Auth::load_or_create(path).unwrap();
        let data = path.join("data");
        let task = RefCell::new(None);
        let spawn = || {
            let listener = listener.borrow_mut().take().expect("start exactly once");
            *task.borrow_mut() = Some(fixture_studio(path, listener, started.clone(), &data));
            Ok(None)
        };
        let opens = RefCell::new(Vec::new());
        let open = |url| {
            opens.borrow_mut().push(url);
            std::future::ready(Ok(()))
        };
        let (first, second) = tokio::join!(
            open_or_start_with(path, &data, spawn, open),
            open_or_start_with(path, &data, spawn, open)
        );
        if let Some(task) = task.into_inner() {
            task.abort();
            let _ = task.await;
        }
        first.unwrap();
        second.unwrap();
        let expected = format!("http://{address}/#token={}", token.token());
        assert_eq!(opens.into_inner(), vec![expected.clone(), expected]);
    }

    /// A verified running Studio: holds running.lock, writes its marker, answers /healthz.
    fn fixture_studio(
        path: &Path,
        listener: TcpListener,
        started: String,
        data_dir: &Path,
    ) -> tokio::task::JoinHandle<()> {
        let lock = launcher_lock(path, "running.lock").unwrap();
        lock.try_lock().unwrap();
        let identity = random_hex().unwrap();
        let marker = Marker {
            version: 2,
            pid: std::process::id(),
            started,
            address: listener.local_addr().unwrap(),
            token_file: path.join("token"),
            identity: identity.clone(),
            data_dir: data_dir.into(),
        };
        let disk = path.join("running.json");
        serde_json::to_writer(File::create(&disk).unwrap(), &marker).unwrap();
        tokio::spawn(async move {
            let _lock = lock;
            axum::serve(
                listener,
                axum::Router::new().route(
                    "/healthz",
                    axum::routing::get(move || async move { identity }),
                ),
            )
            .await
            .unwrap();
        })
    }

    #[tokio::test]
    async fn reopen_with_another_data_dir_is_refused_with_both_paths() {
        let dir = Temp::new();
        let path = &dir.0;
        let running = path.join("running-data");
        let requested = path.join("requested-data");
        let started = platform::process_start(std::process::id()).await.unwrap();
        let listener = bind_loopback(0).await.unwrap();
        let task = fixture_studio(path, listener, started, &running);
        let error = open_or_start_with(
            path,
            &requested,
            || panic!("a running Studio must not be started again"),
            |_: String| std::future::ready(Err("opened another data directory".into())),
        )
        .await
        .unwrap_err();
        assert!(error.contains(&running.display().to_string()), "{error}");
        assert!(error.contains(&requested.display().to_string()), "{error}");
        let opened = open_or_start_with(
            path,
            &running,
            || panic!("a running Studio must not be started again"),
            |url: String| async move {
                assert!(url.contains("#token="));
                Ok(())
            },
        )
        .await;
        // The running folder spelled differently is the same folder, not a refusal.
        fs::create_dir_all(running.join("sub")).unwrap();
        let respelled = open_or_start_with(
            path,
            &running.join("sub").join(".."),
            || panic!("a running Studio must not be started again"),
            |url: String| async move {
                assert!(url.contains("#token="));
                Ok(())
            },
        )
        .await;
        task.abort();
        let _ = task.await;
        opened.unwrap();
        respelled.unwrap();
    }

    #[test]
    fn desktop_paths_follow_core_precedence_and_launch_cwd() {
        let dir = Temp::new();
        let cwd = dir.0.join("launch");
        fs::create_dir_all(cwd.join("cfg")).unwrap();
        fs::write(cwd.join("cfg/config.toml"), "data_dir = \"from-toml\"\n").unwrap();
        let mut env = PathEnvironment::current();
        env.home = Some(dir.0.join("home"));
        env.xdg_config_home = None;
        env.xdg_data_home = None;
        env.appdata = Some(dir.0.join("appdata"));
        env.localappdata = Some(dir.0.join("localappdata"));
        env.data_dir = Some("env-data".into());
        let args = |data: Option<&str>| {
            PathArgs::from_args(
                ["--config", "cfg/config.toml"]
                    .into_iter()
                    .chain(data.into_iter().flat_map(|d| ["--data-dir", d]))
                    .map(OsString::from),
            )
            .unwrap()
        };
        let config = cwd.join("cfg/config.toml");
        // Relative arguments resolve against the launch cwd; the argument wins.
        let explicit = CorePaths::resolve(&args(Some("data")), &cwd, &env).unwrap();
        assert_eq!(
            explicit,
            CorePaths {
                config: config.clone(),
                data_dir: cwd.join("data")
            }
        );
        // Then SHELLBOY_DATA_DIR, then the config's data_dir (relative to the config).
        let from_env = CorePaths::resolve(&args(None), &cwd, &env).unwrap();
        assert_eq!(from_env.data_dir, cwd.join("env-data"));
        env.data_dir = None;
        let from_toml = CorePaths::resolve(&args(None), &cwd, &env).unwrap();
        assert_eq!(from_toml.data_dir, cwd.join("cfg/from-toml"));
        // Without arguments: Core's OS defaults.
        let default = CorePaths::resolve(&PathArgs::default(), &cwd, &env).unwrap();
        assert_eq!(default.config, env.default_config_path().unwrap());
        assert_eq!(default.data_dir, env.default_data_dir().unwrap());
        // The bundle server receives exactly the launcher's resolved pair.
        let server = explicit.server_args();
        assert_eq!(server[0], "bundle-server");
        let received = PathArgs::from_args(server.into_iter().skip(1)).unwrap();
        assert_eq!(CorePaths::resolved(received).unwrap(), explicit);
        assert!(CorePaths::resolved(args(Some("data"))).is_err());
        assert!(PathArgs::from_args(["--no-auth".into()]).is_err());
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
            data_dir: PathBuf::new(),
        };
        assert!(!endpoint_matches(&marker).await);
        marker.identity = "fixture-identity".into();
        assert!(endpoint_matches(&marker).await);
        server.abort();
        let _ = server.await;
    }
}
