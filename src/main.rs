use clap::Parser;
use shellboy::{
    config::{PathEnvironment, resolve_cli_data_dir},
    protocol::{Command, ThreadListArgs},
};
use shellboy_studio::{
    auth::{Auth, default_config_dir},
    events::PollConfig,
    hub::Hub,
    owner::{IpcOwner, Owner},
    server::{AppsPaths, ServerConfig, Shared, serve},
};
use std::{net::SocketAddr, path::PathBuf, process::ExitCode, sync::Arc};
use tokio_util::sync::CancellationToken;

/// Browser bridge for a running Shellboy owner.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Address to listen on. Loopback by default; anything else is plain HTTP.
    #[arg(long, default_value = "127.0.0.1:8751")]
    listen: SocketAddr,
    /// Owner data directory (default: SHELLBOY_DATA_DIR, then the OS default).
    #[arg(long)]
    data_dir: Option<PathBuf>,
    /// Directory for the bridge token (default: the OS config directory).
    #[arg(long)]
    config_dir: Option<PathBuf>,
    /// Extra Host names to accept (for example a Tailscale name). Repeatable.
    #[arg(long = "allow-host")]
    allow_host: Vec<String>,
    /// Folder of apps (default: `apps` in the owner data directory).
    #[arg(long)]
    apps_dir: Option<PathBuf>,
    /// Enable the /debug page (off by default).
    #[arg(long)]
    debug: bool,
}

/// What to tell someone whose first probe of the owner failed: the fact, then the next step.
/// The page keeps retrying, so none of these stop the bridge.
fn owner_problem(data_dir: &std::path::Path, error: &shellboy::protocol::ApiError) -> String {
    use shellboy::protocol::ErrorCode;
    let dir = data_dir.display();
    let next = match error.code {
        ErrorCode::AppNotRunning => format!(
            "No owner is running for the data directory {dir}. Start one there with `shellboy serve --data-dir {dir}` (or the Shellboy TUI), or, if your owner uses another data directory, restart shellboy-studio with --data-dir pointing at it. This window keeps retrying."
        ),
        ErrorCode::ProtocolMismatch => format!(
            "The owner for {dir} speaks a different Shellboy protocol than this shellboy-studio (built for protocol {}). Install the Shellboy release this Studio is paired with (see the README), restart the owner, then reload the page. If the data directory is wrong instead, pass --data-dir.",
            shellboy::protocol::PROTOCOL_VERSION
        ),
        _ => format!(
            "The owner for {dir} could not be used. Check that it runs under the same OS user and that --data-dir is the one it uses. This window keeps retrying."
        ),
    };
    let hint = error
        .hint
        .as_deref()
        .map(|h| format!(" Shellboy says: {h}."))
        .unwrap_or_default();
    format!("shellboy-studio: {} {next}{hint}", error.message)
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Args::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("shellboy-studio: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Args) -> Result<(), String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let data_dir =
        resolve_cli_data_dir(args.data_dir.as_deref(), &PathEnvironment::current(), &cwd)
            .map_err(|e| format!("cannot resolve the owner data directory: {e}"))?;
    let config_dir = match args.config_dir {
        Some(dir) => dir,
        None => default_config_dir()?,
    };
    let auth = Auth::load_or_create(&config_dir)?;
    let owner = Arc::new(IpcOwner::new(data_dir.clone()));
    let probe = owner
        .call(
            Command::ThreadList(ThreadListArgs {
                limit: 1,
                ..Default::default()
            }),
            None,
            None,
        )
        .await;
    if let Err(error) = probe {
        eprintln!("{}", owner_problem(&data_dir, &error));
    }
    if !args.listen.ip().is_loopback() {
        eprintln!(
            "shellboy-studio: warning: {} is not loopback; traffic is plain HTTP unless a TLS tunnel is in front. The token is still required.",
            args.listen
        );
    }
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .map_err(|e| format!("cannot listen on {}: {e}", args.listen))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    println!("open http://{addr}/#token={}", auth.token());
    if args.debug {
        println!("debug page: http://{addr}/debug#token={}", auth.token());
    }
    let cancel = CancellationToken::new();
    let state = Shared::with_apps(
        owner,
        Hub::new(),
        auth,
        ServerConfig {
            listen: addr,
            extra_hosts: args.allow_host,
            data_dir: data_dir.clone(),
            debug: args.debug,
        },
        Some(AppsPaths {
            dir: args.apps_dir.unwrap_or_else(|| data_dir.join("apps")),
        }),
        cancel.clone(),
    );
    let stop = cancel.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        stop.cancel();
    });
    serve(listener, state, PollConfig::default(), cancel)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::owner_problem;
    use shellboy::protocol::{ApiError, ErrorCode};
    use std::path::Path;

    #[test]
    fn each_owner_problem_says_what_to_do_next() {
        let dir = Path::new("/data");
        let none = owner_problem(
            dir,
            &ApiError::new(ErrorCode::AppNotRunning, "Cannot connect"),
        );
        assert!(none.contains("shellboy serve --data-dir /data") && none.contains("--data-dir"));
        let old = owner_problem(
            dir,
            &ApiError::new(ErrorCode::ProtocolMismatch, "CLI uses 2"),
        );
        assert!(old.contains("README") && old.contains("protocol"));
        let other = owner_problem(dir, &ApiError::new(ErrorCode::IoFailed, "x"));
        assert!(other.contains("same OS user"));
    }
}
