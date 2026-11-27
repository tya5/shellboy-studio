//! `run(action, args)`: a script from the app's `actions/`, with a time and output limit. No shell
//! parses anything: the file is chosen by name and passed to its interpreter as one argument.
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

pub const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub const MAX_TIMEOUT_MS: u64 = 600_000;
pub const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_STDIN: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub timed_out: bool,
    pub duration_ms: u64,
}

/// The file `action` names: exact, or that name plus one extension. Two matches are refused, not guessed.
pub async fn find_action(app_dir: &Path, action: &str) -> Result<PathBuf, (&'static str, String)> {
    if action.is_empty()
        || !action
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        || action.starts_with('.')
    {
        return Err(("invalid_action", format!("{action} isn't an action name")));
    }
    let dir = app_dir.join("actions");
    let exact = dir.join(action);
    if tokio::fs::metadata(&exact).await.is_ok_and(|m| m.is_file()) {
        return Ok(exact);
    }
    let mut found = Vec::new();
    let mut read = tokio::fs::read_dir(&dir).await.map_err(|_| {
        (
            "no_action",
            format!("No action {action}: this app has no actions folder"),
        )
    })?;
    while let Ok(Some(item)) = read.next_entry().await {
        let path = item.path();
        if path.file_stem().is_some_and(|s| s == action) && path.is_file() {
            found.push(path);
        }
    }
    match found.len() {
        0 => Err(("no_action", format!("No action {action} in actions/"))),
        1 => Ok(found.remove(0)),
        _ => Err((
            "ambiguous_action",
            format!("More than one file is named {action} in actions/; use the full name"),
        )),
    }
}

/// The interpreter rule, by extension. Anything else runs as the file itself.
pub fn command_for(path: &Path) -> Command {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let with = |program: &str, before: &[&str]| {
        let mut c = Command::new(program);
        c.args(before).arg(path);
        c
    };
    match ext.as_str() {
        "py" if cfg!(windows) => with("py", &["-3"]),
        "py" => with("python3", &[]),
        "js" | "mjs" => with("node", &[]),
        "sh" => with("sh", &[]),
        // Bypass: a default Windows policy refuses every local .ps1, so no action would start.
        "ps1" => with(
            "powershell",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"],
        ),
        "cmd" | "bat" => with("cmd", &["/C"]),
        _ => Command::new(path),
    }
}

/// Reads into `kept` up to `MAX_OUTPUT`, then keeps draining so the script doesn't block on a full pipe.
/// What it read stays in `kept` when the read is cut short.
async fn read_capped<R: AsyncRead + Unpin>(reader: Option<R>, kept: &mut (Vec<u8>, bool)) {
    let Some(mut reader) = reader else { return };
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                let room = MAX_OUTPUT.saturating_sub(kept.0.len());
                kept.0.extend_from_slice(&chunk[..n.min(room)]);
                kept.1 |= n > room;
            }
        }
    }
}

/// The script and everything it starts: its own process group on Unix, a kill-on-close Job on Windows.
/// Killed once, when the script exits, at the time limit or on a closed page (drop), so a helper it left
/// running can't outlive the call or hold its output pipes open.
struct Tree {
    #[cfg(unix)]
    group: Option<i32>,
    #[cfg(windows)]
    job: job::Job,
    killed: bool,
}

impl Tree {
    /// On Unix this runs before the script is reaped: until then its pid, and so the group ID, can't be
    /// reused, so the signal reaches only this action's processes. It is sent once.
    fn kill(&mut self) {
        if std::mem::replace(&mut self.killed, true) {
            return;
        }
        #[cfg(unix)]
        if let Some(group) = self.group {
            unsafe { libc::killpg(group, libc::SIGKILL) };
        }
        #[cfg(windows)]
        self.job.terminate();
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(windows)]
mod job {
    //! A kill-on-close Job. The script starts suspended, joins the Job and only then runs, so nothing it
    //! starts escapes the Job.
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::ptr::null;
    use windows_sys::Win32::{
        Foundation::{HANDLE, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First,
                Thread32Next,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
            Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
        },
    };

    pub use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;

    fn owned(handle: HANDLE) -> std::io::Result<OwnedHandle> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    /// Closing the handle (drop) kills every process still in the Job.
    pub struct Job(OwnedHandle);

    impl Job {
        pub fn new() -> std::io::Result<Self> {
            let job = owned(unsafe { CreateJobObjectW(null(), null()) })?;
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    job.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&raw const limits).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(Self(job))
        }

        /// A process started with `CREATE_SUSPENDED` joins the Job, then its one thread resumes.
        pub fn start(&self, process: HANDLE, pid: u32) -> std::io::Result<()> {
            if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), process) } == 0 {
                return Err(std::io::Error::last_os_error());
            }
            let snapshot = owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
            let mut entry = THREADENTRY32 {
                dwSize: size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            let mut more = unsafe { Thread32First(snapshot.as_raw_handle(), &mut entry) } != 0;
            let mut resumed = false;
            while more {
                if entry.th32OwnerProcessID == pid {
                    let thread =
                        owned(unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) })?;
                    if unsafe { ResumeThread(thread.as_raw_handle()) } == u32::MAX {
                        return Err(std::io::Error::last_os_error());
                    }
                    resumed = true;
                }
                more = unsafe { Thread32Next(snapshot.as_raw_handle(), &mut entry) } != 0;
            }
            if resumed {
                Ok(())
            } else {
                Err(std::io::Error::other(
                    "the suspended script has no thread to resume",
                ))
            }
        }

        pub fn terminate(&self) {
            unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
        }
    }
}

/// Resolves once the script has exited, or with the error that stopped this from telling. It runs in
/// `run`, the child's one owner, and stops with it: no detached wait on a bare process ID. On Unix it
/// doesn't reap the script (`WNOWAIT`), so the group ID stays this action's until `Tree::kill` has run;
/// `Child::wait` reaps it afterwards. It looks again on each `SIGCHLD`, registered before the first look.
#[cfg(unix)]
async fn exited(child: &tokio::process::Child) -> std::io::Result<()> {
    use tokio::signal::unix::{SignalKind, signal};
    let pid = child
        .id()
        .ok_or_else(|| std::io::Error::other("the script has no process ID"))?;
    let mut changed = signal(SignalKind::child())?;
    while !has_exited(pid)? {
        changed
            .recv()
            .await
            .ok_or_else(|| std::io::Error::other("SIGCHLD can no longer be received"))?;
    }
    Ok(())
}

/// One look, without reaping: true once `pid` has exited.
#[cfg(unix)]
fn has_exited(pid: u32) -> std::io::Result<bool> {
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let waited = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
            )
        };
        if waited == 0 {
            // With `WNOHANG`, no process ID in the answer means it still runs.
            return Ok(unsafe { info.si_pid() } != 0);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

/// The Job, not the process ID, names the tree on Windows, so waiting may reap.
#[cfg(windows)]
async fn exited(child: &mut tokio::process::Child) -> std::io::Result<()> {
    child.wait().await.map(drop)
}

/// How long output is still read after the script exits and its tree is killed. Only a process that left
/// the tree (a new session, say) can hold the pipes that long.
const DRAIN: Duration = Duration::from_secs(1);

pub async fn run(
    app_name: &str,
    app_dir: &Path,
    script: &Path,
    args: &serde_json::Value,
    timeout_ms: Option<u64>,
) -> Result<RunResult, (&'static str, String)> {
    let input = serde_json::to_vec(args).map_err(|e| ("invalid_args", e.to_string()))?;
    if input.len() > MAX_STDIN {
        return Err(("invalid_args", "args are over 8 MiB".to_owned()));
    }
    let limit = Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1, MAX_TIMEOUT_MS),
    );
    let started = Instant::now();
    let failed = |e: std::io::Error| {
        (
            "run_failed",
            format!("Couldn't start {}: {e}", script.display()),
        )
    };
    let mut command = command_for(script);
    command
        .current_dir(app_dir)
        .env("SHELLBOY_APP_NAME", app_name)
        .env("SHELLBOY_APP_DATA", app_dir.join("data"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Dropping the future (time limit, closed page) kills the script; `Tree` kills the rest.
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    let job = job::Job::new().map_err(failed)?;
    #[cfg(windows)]
    command.creation_flags(job::CREATE_SUSPENDED);
    let mut child = command.spawn().map_err(failed)?;
    #[cfg(windows)]
    if let Err(e) = job.start(
        child.raw_handle().unwrap_or(std::ptr::null_mut()),
        child.id().unwrap_or(0),
    ) {
        let _ = child.start_kill();
        return Err(failed(e));
    }
    let mut tree = Tree {
        #[cfg(unix)]
        group: child.id().and_then(|id| i32::try_from(id).ok()),
        #[cfg(windows)]
        job,
        killed: false,
    };
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut out = (Vec::new(), false);
    let mut err = (Vec::new(), false);
    let (status, timed_out) = {
        let mut reading = std::pin::pin!(async {
            tokio::join!(read_capped(stdout, &mut out), read_capped(stderr, &mut err));
        });
        let mut read = false;
        // The time limit covers the script, not the draining after it: an exit seen in time stands.
        let in_time = {
            let mut feed = std::pin::pin!(async {
                if let Some(mut s) = stdin {
                    let _ = s.write_all(&input).await;
                }
            });
            #[cfg(unix)]
            let mut exit = std::pin::pin!(exited(&child));
            #[cfg(windows)]
            let mut exit = std::pin::pin!(exited(&mut child));
            let mut fed = false;
            tokio::time::timeout(limit, async {
                loop {
                    tokio::select! {
                        () = &mut feed, if !fed => fed = true,
                        () = &mut reading, if !read => read = true,
                        observed = &mut exit => break observed,
                    }
                }
            })
            .await
        };
        // One kill while the script is unreaped, then reap, then read what the pipes still hold.
        tree.kill();
        let status = child.wait().await;
        match &in_time {
            // Not seen to exit: it was killed and reaped, but nothing is reported as its exit.
            Ok(Err(e)) => {
                return Err((
                    "run_failed",
                    format!("Couldn't follow {}: {e}", script.display()),
                ));
            }
            Ok(Ok(())) if !read => {
                let _ = tokio::time::timeout(DRAIN, &mut reading).await;
            }
            _ => {}
        }
        let status = status.map_err(|e| {
            (
                "run_failed",
                format!("Couldn't reap {}: {e}", script.display()),
            )
        })?;
        (Some(status), in_time.is_err())
    };
    let finish = |status: Option<std::process::ExitStatus>,
                  out: (Vec<u8>, bool),
                  err: (Vec<u8>, bool),
                  timed_out: bool| RunResult {
        exit_code: status.and_then(|s| s.code()),
        stdout: String::from_utf8_lossy(&out.0).into_owned(),
        stderr: String::from_utf8_lossy(&err.0).into_owned(),
        stdout_truncated: out.1,
        stderr_truncated: err.1,
        timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    if timed_out {
        return Ok(finish(None, (Vec::new(), false), (Vec::new(), false), true));
    }
    Ok(finish(status, out, err, false))
}
