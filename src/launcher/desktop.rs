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
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
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

pub(super) const OWNER_START_TIMEOUT: Duration = Duration::from_secs(15);
/// `owner.log` and `studio.log` each keep at most this many bytes, plus one older copy (`<name>.1`).
pub(super) const LOG_CAP: u64 = 8 * 1024 * 1024;

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
    requests: mpsc::Receiver<super::Request>,
    state: watch::Sender<super::State>,
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
        let (send, requests) = mpsc::channel(1);
        let (state, state_rx) = watch::channel(super::State::starting());
        let (diagnostic, receiver) = watch::channel(None);
        let owner = ManagedOwner {
            bundled,
            config,
            cwd: cwd.into(),
            log: dir.join("owner.log"),
            data: data_dir.clone(),
            env: None,
            child: None,
            ready: watch::channel(None).1,
            instance_id: None,
            output: None,
            start_log_offset: Arc::default(),
        };
        Ok(Some(Self {
            listener: Some(listener),
            data_dir,
            auth: Some(auth),
            control: Control {
                diagnostic: receiver,
                requests: send,
                state: state_rx,
                marker: identity,
            },
            marker: marker_path,
            _lock: lock,
            owner,
            requests,
            state,
            diagnostic,
            crashes: std::collections::VecDeque::new(),
        }))
    }

    pub async fn supervise(&mut self, cancel: CancellationToken) {
        use super::{Action, Phase, State};
        use crate::launcher::supervisor::{Decision, RestartState};
        let mut restart_state = RestartState::new();
        self.start().await;
        loop {
            if self.owner.child.is_none() {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    request = self.requests.recv() => {
                        let Some(request) = request else { break };
                        if request.instance_id.is_none() && matches!(request.action, Action::Start | Action::Restart) {
                            restart_state.manual_start();
                            self.state.send_replace(State::starting());
                            self.start().await;
                        }
                    }
                }
                continue;
            }
            let mut ready = false;
            let mut ready_closed = false;
            let mut manual = None;
            let exit = loop {
                let child = &mut self.owner.child;
                let ready_signal = &mut self.owner.ready;
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break None,
                    request = self.requests.recv() => {
                        let Some(request) = request else { break None; };
                        // An accepted manual action leaves through a separate branch before exit classification.
                        if matches!(request.action, Action::Stop | Action::Restart)
                            && request.instance_id == self.owner.instance_id
                            && (request.instance_id.is_some() || request.action == Action::Stop)
                        {
                            self.state.send_modify(|state| state.phase = Phase::Stopping);
                            platform::stop_child(self.owner.child.take(), &self.owner.data, request.instance_id.as_deref()).await;
                            manual = Some(request.action);
                            break None;
                        }
                    },
                    result = async { match child { Some(p) => p.wait().await, None => std::future::pending().await } } => {
                        self.owner.child = None;
                        break Some(result);
                    },
                    changed = ready_signal.changed(), if !ready && !ready_closed => {
                        if changed.is_ok() {
                            if let Some(instance_id) = ready_signal.borrow_and_update().clone() {
                                ready = true;
                                self.state.send_modify(|state| {
                                    state.phase = Phase::Running;
                                    state.instance_id = Some(instance_id.clone());
                                    state.ready_at_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok().and_then(|elapsed| elapsed.as_millis().try_into().ok());
                                });
                                self.owner.instance_id = Some(instance_id);
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
            if let Some(action) = manual {
                if let Some(output) = self.owner.output.take() {
                    let _ = output.await;
                }
                self.owner.instance_id = None;
                if cancel.is_cancelled() {
                    break;
                }
                if restart_state.explicit_exit(action == Action::Restart) {
                    self.state.send_replace(State::starting());
                    self.start().await;
                } else {
                    self.state.send_replace(State {
                        phase: Phase::Stopped,
                        automatic_restart_available: restart_state.available(),
                        ..State::starting()
                    });
                }
                continue;
            }
            let Some(result) = exit else { break };
            if let Some(output) = self.owner.output.take() {
                let _ = output.await;
            }
            if let Some(instance_id) = self.owner.ready.borrow().clone() {
                ready = true;
                self.owner.instance_id = Some(instance_id);
            }
            let status = result.ok();
            let status_text = match &status {
                Some(status) if ready => format!("Core exited with {status}"),
                Some(status) => format!("Core exited before ready with {status}"),
                None if ready => "Core child wait failed".into(),
                None => "Core child wait failed before ready".into(),
            };
            let startup_failure = if ready {
                None
            } else {
                self.owner.startup_failure()
            };
            let child_exit = super::supervisor::classify(
                ready,
                status.as_ref().map(std::process::ExitStatus::success),
                status_text,
                startup_failure,
            );
            let decision = restart_state.exited(ready, child_exit);
            match decision {
                Decision::Stop => {
                    self.state.send_replace(State {
                        phase: Phase::Exited,
                        automatic_restart_available: restart_state.available(),
                        ..State::starting()
                    });
                    continue;
                }
                Decision::ShowFailure(reason) => {
                    self.state.send_modify(|state| {
                        state.phase = Phase::Failed;
                        state.instance_id = None;
                        state.ready_at_ms = None;
                        state.failure = Some(reason.clone());
                    });
                    self.publish_crash(reason);
                    continue;
                }
                Decision::Retry { reason } => {
                    self.state.send_replace(State {
                        automatic_restart_available: false,
                        restarted_after: Some(reason.clone()),
                        ..State::starting()
                    });
                    self.publish_crash(format!(
                        "Core crashed after ready ({reason}); restarting now"
                    ));
                    self.start().await;
                }
            }
        }
        platform::stop_child(
            self.owner.child.take(),
            &self.owner.data,
            self.owner.instance_id.as_deref(),
        )
        .await;
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
                if self.owner.child.is_none() {
                    self.state
                        .send_modify(|state| state.phase = super::Phase::External);
                }
                self.crashes.clear();
                self.diagnostic.send_replace(warning);
            }
            Err(reason) => {
                eprintln!(
                    "shellboy-studio: bundled owner start refused or failed: {}",
                    reason.reason
                );
                self.state.send_modify(|state| {
                    state.phase = super::Phase::Failed;
                    state.failure = Some(reason.message().into());
                });
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
    ready: watch::Receiver<Option<String>>,
    instance_id: Option<String>,
    output: Option<tokio::task::JoinHandle<()>>,
    /// Where this start's output begins in `log`; the log's writer resets it when it rotates.
    start_log_offset: Arc<AtomicU64>,
}

impl ManagedOwner {
    fn startup_failure(&self) -> Option<String> {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = File::open(&self.log).ok()?;
        let length = file.metadata().ok()?.len();
        const TAIL: u64 = 16 * 1024;
        let start = self
            .start_log_offset
            .load(Ordering::SeqCst)
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
        // The one writer of owner.log: Core's stdout and stderr, from `config init` and `serve`.
        let mut log =
            LogWriter::open(self.log.clone(), self.start_log_offset.clone()).map_err(io)?;
        match fs::symlink_metadata(&self.config) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut init = process()
                    .args(["config", "init"])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .map_err(io)?;
                let (stdout, stderr) = (init.stdout.take(), init.stderr.take());
                let result = timeout(Duration::from_secs(10), async {
                    copy_output(&mut log, stdout, stderr, |_| {}).await;
                    init.wait().await
                })
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
            .stderr(Stdio::piped());
        self.start_log_offset.store(log.len, Ordering::SeqCst);
        let mut child = spawn(command)?;
        let (ready_tx, ready_rx) = watch::channel(None);
        self.ready = ready_rx;
        self.instance_id = None;
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        self.output = (stdout.is_some() || stderr.is_some()).then(|| {
            tokio::spawn(async move {
                copy_output(&mut log, stdout, stderr, |line| {
                    if let Some(instance_id) = super::supervisor::ready_instance_line(line) {
                        ready_tx.send_replace(Some(instance_id));
                    }
                })
                .await;
            })
        });
        self.child = Some(child);
        Ok(env.warning.clone())
    }
}

/// An append-only log that keeps at most `LOG_CAP` bytes: a write that would pass the cap first moves the
/// file to `<name>.1`, replacing the older copy, and starts a new one. Only its owner writes the file.
struct LogWriter {
    path: PathBuf,
    file: Option<tokio::fs::File>,
    len: u64,
    /// A start offset into this file, reset when the file is replaced.
    start: Arc<AtomicU64>,
}

impl LogWriter {
    fn open(path: PathBuf, start: Arc<AtomicU64>) -> std::io::Result<Self> {
        let file = open_log(&path)?;
        let len = file.metadata()?.len();
        Ok(Self {
            path,
            file: Some(tokio::fs::File::from_std(file)),
            len,
            start,
        })
    }

    async fn write(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if self.len > 0 && self.len + bytes.len() as u64 > LOG_CAP {
            // Closed first: Windows doesn't rename an open file.
            if let Some(mut file) = self.file.take() {
                file.flush().await?;
            }
            let path = self.path.clone();
            let file = tokio::task::spawn_blocking(move || {
                rotate_log(&path)?;
                open_log(&path)
            })
            .await
            .map_err(std::io::Error::other)??;
            self.file = Some(tokio::fs::File::from_std(file));
            self.len = 0;
            self.start.store(0, Ordering::SeqCst);
        }
        // A single write over the cap is cut, not kept whole.
        let kept = &bytes[..bytes.len().min(LOG_CAP as usize)];
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("log closed"))?;
        file.write_all(kept).await?;
        self.len += kept.len() as u64;
        Ok(())
    }

    async fn flush(&mut self) {
        if let Some(file) = &mut self.file {
            let _ = file.flush().await;
        }
    }
}

/// `<name>` becomes `<name>.1`, replacing the older copy.
fn rotate_log(path: &Path) -> std::io::Result<()> {
    let mut older = path.as_os_str().to_owned();
    older.push(".1");
    fs::rename(path, older)
}

/// Up to this much of an unfinished line is held back, so the two streams don't mix within a line.
const LOG_LINE: usize = 8192;

/// Copies a child's stdout and stderr into `log` until both close, a whole line at a time per stream, so a
/// line from one never splits a line of the other. `on_line` sees each stdout line up to `LOG_LINE`; a
/// longer one is written as it comes and skipped. A failed write ends the copy, and the pipes close with it.
async fn copy_output(
    log: &mut LogWriter,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    mut on_line: impl FnMut(&[u8]),
) {
    let (mut stdout, mut stderr) = (stdout, stderr);
    let mut out = [0_u8; 4096];
    let mut err = [0_u8; 4096];
    let (mut out_line, mut err_line) = (Vec::new(), Vec::new());
    let mut oversized = false;
    while stdout.is_some() || stderr.is_some() {
        let (read, line, is_stdout) = tokio::select! {
            read = async { stdout.as_mut().expect("guarded").read(&mut out).await }, if stdout.is_some() => {
                match read {
                    Ok(0) | Err(_) => { stdout = None; (&[][..], &mut out_line, true) }
                    Ok(count) => (&out[..count], &mut out_line, true),
                }
            }
            read = async { stderr.as_mut().expect("guarded").read(&mut err).await }, if stderr.is_some() => {
                match read {
                    Ok(0) | Err(_) => { stderr = None; (&[][..], &mut err_line, false) }
                    Ok(count) => (&err[..count], &mut err_line, false),
                }
            }
        };
        let closed = read.is_empty();
        for piece in read.split_inclusive(|byte| *byte == b'\n') {
            line.extend_from_slice(piece);
            let complete = line.ends_with(b"\n");
            if is_stdout && complete && !oversized {
                on_line(&line[..line.len() - 1]);
            }
            if complete || line.len() >= LOG_LINE {
                if is_stdout {
                    oversized = !complete;
                }
                if log.write(line).await.is_err() {
                    return;
                }
                line.clear();
            }
        }
        if closed && !line.is_empty() {
            if log.write(line).await.is_err() {
                return;
            }
            line.clear();
        }
    }
    log.flush().await;
}

pub(super) fn io(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(any(windows, test))]
pub(super) async fn stop_owned_child(
    mut child: Child,
    shutdown: impl std::future::Future<Output = bool>,
    grace: Duration,
) -> bool {
    if shutdown.await
        && timeout(grace, child.wait())
            .await
            .is_ok_and(|result| result.is_ok())
    {
        return false;
    }
    let _ = child.kill().await;
    true
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
        |log, stderr| {
            let mut command = std::process::Command::new(std::env::current_exe().map_err(io)?);
            platform::detach(&mut command);
            command
                .args(paths.server_args())
                .stdin(Stdio::null())
                .stdout(log)
                .stderr(stderr);
            command.spawn().map(Some).map_err(io)
        },
        |url| async move { platform::open_browser(&url).await },
    )
    .await
}

async fn open_or_start_with<F: std::future::Future<Output = Result<(), String>>>(
    dir: &Path,
    data_dir: &Path,
    spawn: impl FnOnce(File, File) -> Result<Option<std::process::Child>, String>,
    open: impl FnOnce(String) -> F,
) -> Result<(), String> {
    let storage_error = |path: &Path, cause: &dyn std::fmt::Display| {
        format!(
            "Cannot use Studio's settings or log path {}: {cause}. Make sure the folder is available and your account can write there; on a managed PC, ask IT to check access.",
            path.display()
        )
    };
    fs::create_dir_all(dir).map_err(|e| storage_error(dir, &e))?;
    platform::check_directory(dir).map_err(|e| storage_error(dir, &e))?;
    let guard = launcher_lock(dir, "launcher.lock")
        .map_err(|e| storage_error(&dir.join("launcher.lock"), &e))?;
    // Serializes desktop launchers, not the separate server's lifetime.
    let _guard = tokio::task::spawn_blocking(move || {
        guard.lock()?;
        Ok::<_, std::io::Error>(guard)
    })
    .await
    .map_err(io)?
    .map_err(io)?;
    let running = launcher_lock(dir, "running.lock")
        .map_err(|e| storage_error(&dir.join("running.lock"), &e))?;
    let mut child = match running.try_lock() {
        Ok(()) => {
            let marker = dir.join("running.json");
            fs::remove_file(&marker)
                .or_else(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })
                .map_err(|e| storage_error(&marker, &e))?;
            let path = dir.join("studio.log");
            // This server holds studio.log for its lifetime, so the cap is applied as it starts.
            if fs::metadata(&path).is_ok_and(|metadata| metadata.len() >= LOG_CAP) {
                rotate_log(&path).map_err(|e| storage_error(&path, &e))?;
            }
            let log = open_log(&path).map_err(|e| storage_error(&path, &e))?;
            let stderr = log.try_clone().map_err(|e| storage_error(&path, &e))?;
            drop(running);
            spawn(log, stderr)?
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

#[cfg(target_os = "macos")]
pub async fn show_macos_startup_error() {
    // Use static text: an error can include a private path or browser URL.
    let _ = Process::new("/usr/bin/osascript")
        .args(["-e", r#"display alert "Shellboy Studio could not open" message "Check that the app was fully extracted and that your default browser works. If it still does not open, look for studio.log in ~/Library/Application Support/shellboy-studio or see the Studio user guide on GitHub." as critical"#])
        .status()
        .await;
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
    fn graceful_child_fixture() {
        use std::io::Read;
        let mut input = std::io::stdin();
        let mut bytes = Vec::new();
        let _ = input.read_to_end(&mut bytes);
    }

    #[test]
    #[ignore = "subprocess fixture only"]
    fn fake_core_child() {
        match std::env::var("STUDIO_FAKE_CORE_MODE").as_deref() {
            Ok("ready-crash") => {
                println!();
                println!(r#"{{"event":"ready","state":"ready","instance_id":"fixture-instance"}}"#);
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
        owner
            .start_with(&Probe, move |_| {
                // Piped like the real command: stderr reaches owner.log through the one writer.
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
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
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
    async fn graceful_shutdown_is_requested_before_force_termination() {
        let child = Process::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "launcher::desktop::tests::graceful_child_fixture",
                "--ignored",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut child = child;
        let stdin = child.stdin.take().unwrap();
        let forced = stop_owned_child(
            child,
            async move {
                drop(stdin);
                true
            },
            Duration::from_secs(1),
        )
        .await;
        assert!(
            !forced,
            "a successful graceful shutdown must not force-kill"
        );

        let child = sleeper();
        let pid = child.id().unwrap();
        let forced = stop_owned_child(child, async { false }, Duration::from_secs(1)).await;
        assert!(
            forced,
            "a failed shutdown request must force-terminate the owned child"
        );
        assert!(platform::process_start(pid).await.is_none());
    }

    #[tokio::test]
    async fn shutdown_only_signals_the_owned_child() {
        let mut unrelated = sleeper();
        platform::stop_child(None, Path::new("unused"), None).await;
        assert!(unrelated.try_wait().unwrap().is_none());
        let owned = sleeper();
        let pid = owned.id().unwrap();
        assert!(platform::process_start(pid).await.is_some());
        platform::stop_child(Some(owned), Path::new("unused"), None).await;
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
            ready: watch::channel(None).1,
            instance_id: None,
            output: None,
            start_log_offset: Arc::default(),
        };
        let mut external = sleeper();
        owner
            .start_with(&Probe(true), |_| panic!("reachable owner must not spawn"))
            .await
            .unwrap();
        assert!(owner.child.is_none(), "attached, not owned");
        platform::stop_child(
            owner.child.take(),
            &owner.data,
            owner.instance_id.as_deref(),
        )
        .await;
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
        platform::stop_child(
            owner.child.take(),
            &owner.data,
            owner.instance_id.as_deref(),
        )
        .await;
        assert!(external.try_wait().unwrap().is_none());
        external.kill().await.unwrap();
    }

    #[tokio::test]
    async fn a_log_keeps_one_older_copy_at_the_cap() {
        let dir = Temp::new();
        let path = dir.0.join("owner.log");
        let older = dir.0.join("owner.log.1");
        let start = Arc::new(AtomicU64::new(0));
        let mut log = LogWriter::open(path.clone(), start.clone()).unwrap();
        let first = vec![b'a'; LOG_CAP as usize - 4];
        log.write(&first).await.unwrap();
        start.store(LOG_CAP - 4, Ordering::SeqCst);
        log.write(b"bbbbbbbb").await.unwrap();
        log.flush().await;
        assert_eq!(fs::read(&older).unwrap(), first);
        assert_eq!(fs::read(&path).unwrap(), b"bbbbbbbb");
        assert_eq!(
            start.load(Ordering::SeqCst),
            0,
            "the start moves to the new file"
        );
        log.write(&vec![b'c'; LOG_CAP as usize]).await.unwrap();
        log.flush().await;
        assert_eq!(
            fs::read(&older).unwrap(),
            b"bbbbbbbb",
            "only one older copy"
        );
        assert_eq!(fs::metadata(&path).unwrap().len(), LOG_CAP);
        drop(log);
        // A reopened log continues the same file and the same cap.
        let mut log = LogWriter::open(path.clone(), start).unwrap();
        log.write(b"d").await.unwrap();
        log.flush().await;
        assert_eq!(fs::read(&path).unwrap(), b"d");
        assert_eq!(fs::metadata(&older).unwrap().len(), LOG_CAP);
    }

    #[tokio::test]
    async fn fake_child_ready_crash_retries_and_pre_ready_error_stops_with_typed_reason() {
        use crate::launcher::supervisor::{Decision, RestartState};
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
            ready: watch::channel(None).1,
            instance_id: None,
            output: None,
            start_log_offset: Arc::default(),
        };

        let mut crashing = make_owner();
        let status = fake_core(&mut crashing, "ready-crash").await;
        assert_eq!(status.code(), Some(1));
        assert_eq!(crashing.ready.borrow().as_deref(), Some("fixture-instance"));
        let mut state = RestartState::new();
        let crash = crate::launcher::supervisor::classify(
            crashing.ready.borrow().is_some(),
            Some(status.success()),
            format!("Core exited with {status}"),
            None,
        );
        assert!(matches!(state.exited(true, crash), Decision::Retry { .. }));

        let mut failing = make_owner();
        let status = fake_core(&mut failing, "startup-error").await;
        assert_eq!(status.code(), Some(1));
        assert!(failing.ready.borrow().is_none());
        let reason = failing
            .startup_failure()
            .expect("typed startup error from child log");
        assert_eq!(reason, "bad config repair the config");
        let failure = crate::launcher::supervisor::classify(
            failing.ready.borrow().is_some(),
            Some(status.success()),
            format!("Core exited before ready with {status}"),
            Some(reason),
        );
        assert_eq!(
            state.exited(false, failure),
            Decision::ShowFailure("bad config repair the config".into())
        );
    }

    #[tokio::test]
    async fn inaccessible_desktop_storage_names_path_before_spawn_or_browser() {
        let temp = Temp::new();
        let blocked_settings = temp.0.join("settings-file");
        fs::write(&blocked_settings, "not a directory").unwrap();
        let settings = temp.0.join("settings");
        let blocked_log = settings.join("studio.log");
        fs::create_dir_all(&blocked_log).unwrap();
        for (dir, blocked) in [
            (&blocked_settings, &blocked_settings),
            (&settings, &blocked_log),
        ] {
            let error = open_or_start_with(
                dir,
                &temp.0.join("data"),
                |_, _| panic!("must not spawn with inaccessible storage"),
                |_| std::future::ready(Err("browser was called".into())),
            )
            .await
            .unwrap_err();
            assert!(error.contains(&blocked.display().to_string()), "{error}");
            assert!(error.contains("your account can write there"), "{error}");
        }
    }

    #[tokio::test]
    async fn a_full_studio_log_is_set_aside_when_a_server_starts() {
        let dir = Temp::new();
        let log = dir.0.join("studio.log");
        fs::write(&log, vec![b'x'; LOG_CAP as usize]).unwrap();
        let error = open_or_start_with(
            &dir.0,
            &dir.0.join("data"),
            |_, _| Err("spawned".into()),
            |_| std::future::ready(Err("browser was called".into())),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "spawned");
        assert_eq!(
            fs::metadata(dir.0.join("studio.log.1")).unwrap().len(),
            LOG_CAP
        );
        assert_eq!(fs::metadata(&log).unwrap().len(), 0);
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
        let spawn = |_: File, _: File| {
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
            |_, _| panic!("a running Studio must not be started again"),
            |_: String| std::future::ready(Err("opened another data directory".into())),
        )
        .await
        .unwrap_err();
        assert!(error.contains(&running.display().to_string()), "{error}");
        assert!(error.contains(&requested.display().to_string()), "{error}");
        let opened = open_or_start_with(
            path,
            &running,
            |_, _| panic!("a running Studio must not be started again"),
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
            |_, _| panic!("a running Studio must not be started again"),
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
