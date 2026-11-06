use clap::Parser;
use shellboy::{
    config::{PathEnvironment, resolve_cli_data_dir},
    protocol::{Command, ThreadListArgs},
};
use shellboy_web::{
    auth::{Auth, default_config_dir},
    events::PollConfig,
    hub::Hub,
    owner::{IpcOwner, Owner},
    server::{ServerConfig, Shared, serve},
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
    /// Enable the /debug page (off by default).
    #[arg(long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Args::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("shellboy-web: {message}");
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
        eprintln!(
            "shellboy-web: no owner reachable in {} ({}). Start one with `shellboy serve --data-dir DIR` or the TUI; the bridge keeps retrying.",
            data_dir.display(),
            error.message
        );
    }
    if !args.listen.ip().is_loopback() {
        eprintln!(
            "shellboy-web: warning: {} is not loopback; traffic is plain HTTP unless a TLS tunnel is in front. The token is still required.",
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
    let state = Shared::new(
        owner,
        Hub::new(),
        auth,
        ServerConfig {
            listen: addr,
            extra_hosts: args.allow_host,
            debug: args.debug,
        },
    );
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        stop.cancel();
    });
    serve(listener, state, PollConfig::default(), cancel)
        .await
        .map_err(|e| e.to_string())
}
