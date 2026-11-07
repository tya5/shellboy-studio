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
        "ps1" => with("powershell", &["-NoProfile", "-File"]),
        "cmd" | "bat" => with("cmd", &["/C"]),
        _ => Command::new(path),
    }
}

async fn read_capped<R: AsyncRead + Unpin>(mut reader: R) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut cut = false;
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => return (kept, cut),
            Ok(n) => {
                let room = MAX_OUTPUT.saturating_sub(kept.len());
                kept.extend_from_slice(&chunk[..n.min(room)]);
                // Keep draining so the script doesn't block on a full pipe.
                cut |= n > room;
            }
        }
    }
}

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
    let mut child = command_for(script)
        .current_dir(app_dir)
        .env("SHELLBOY_APP_NAME", app_name)
        .env("SHELLBOY_APP_DATA", app_dir.join("data"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Dropping the future (time limit, closed page) kills it.
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            (
                "run_failed",
                format!("Couldn't start {}: {e}", script.display()),
            )
        })?;
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let work = async {
        let feed = async {
            if let Some(mut s) = stdin.take() {
                let _ = s.write_all(&input).await;
            }
        };
        let out = async {
            match stdout {
                Some(s) => read_capped(s).await,
                None => (Vec::new(), false),
            }
        };
        let err = async {
            match stderr {
                Some(s) => read_capped(s).await,
                None => (Vec::new(), false),
            }
        };
        let (_, out, err) = tokio::join!(feed, out, err);
        let status = child.wait().await.ok();
        (status, out, err)
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
    match tokio::time::timeout(limit, work).await {
        Ok((status, out, err)) => Ok(finish(status, out, err, false)),
        Err(_) => Ok(finish(None, (Vec::new(), false), (Vec::new(), false), true)),
    }
}
