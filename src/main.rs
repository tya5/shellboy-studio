use clap::{Parser, Subcommand, ValueEnum};
use shellboy::config::{PathEnvironment, resolve_cli_data_dir};
use shellboy_studio::{
    auth::{Auth, default_config_dir},
    events::PollConfig,
    hub::Hub,
    owner::{IpcOwner, startup_probe},
    server::{AppsPaths, ServerConfig, Shared, serve},
};
use std::{net::SocketAddr, path::PathBuf, process::ExitCode, sync::Arc};
use tokio_util::sync::CancellationToken;

/// Browser bridge for a running Shellboy owner.
#[derive(Parser)]
#[command(version)]
struct Args {
    #[command(subcommand)]
    command: Option<CliCommand>,
    /// Address to listen on. Loopback by default; anything else is plain HTTP.
    #[arg(long, default_value = "127.0.0.1:8751")]
    listen: SocketAddr,
    /// Owner data directory (default: SHELLBOY_DATA_DIR, then the OS default).
    #[arg(long)]
    data_dir: Option<PathBuf>,
    /// Directory for the bridge token (default: the OS config directory).
    #[arg(long)]
    config_dir: Option<PathBuf>,
    /// Extra Host names reachable from other devices via HTTPS proxy/VPN. Repeatable.
    #[arg(long = "allow-host")]
    allow_host: Vec<String>,
    /// Skip token/session checks. Only for trusted access; NEVER expose publicly (e.g. Funnel).
    #[arg(long)]
    no_auth: bool,
    /// Folder of apps (default: `apps` in the owner data directory).
    #[arg(long)]
    apps_dir: Option<PathBuf>,
    /// Enable the /debug page (off by default).
    #[arg(long)]
    debug: bool,
}

#[derive(Subcommand)]
enum CliCommand {
    #[cfg(target_os = "macos")]
    #[command(hide = true)]
    BundleServer,
    /// Print a bundled Studio guide without starting the bridge.
    Guide { guide: GuideKind },
}

#[derive(Clone, ValueEnum)]
enum GuideKind {
    User,
    Agent,
}

const USER_GUIDE: &str = include_str!("../docs/guides/user-guide.md");
const AGENT_GUIDE: &str = include_str!("../docs/guides/agent-guide.md");

fn install_agent_guide(data_dir: &std::path::Path) -> std::io::Result<()> {
    let dir = data_dir.join("studio");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("agent-guide.md"), AGENT_GUIDE)?;
    std::fs::write(
        dir.join("agent-pointer.md"),
        "When asked to make an app or web tool, first read $SHELLBOY_DATA_DIR/studio/agent-guide.md.\n",
    )
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
    match entry().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("shellboy-studio: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn entry() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let bundled = exe
            .parent()
            .and_then(std::path::Path::parent)
            .is_some_and(|p| {
                p.ends_with("Contents")
                    && p.parent()
                        .and_then(std::path::Path::extension)
                        .is_some_and(|ext| ext == "app")
            });
        if bundled
            && std::env::args_os()
                .skip(1)
                .all(|a| a.to_string_lossy().starts_with("-psn_"))
        {
            return shellboy_studio::launcher::macos::open_or_start(&default_config_dir()?).await;
        }
    }
    run(Args::parse()).await
}

#[cfg(target_os = "macos")]
async fn run_bundle_server() -> Result<(), String> {
    let config_dir = default_config_dir()?;
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let Some(mut launch) =
        shellboy_studio::launcher::macos::Launch::prepare(&config_dir, &cwd).await?
    else {
        return Ok(());
    };
    let listener = launch.listener.take().expect("prepared listener");
    let config = ServerConfig {
        listen: listener.local_addr().map_err(|e| e.to_string())?,
        extra_hosts: Vec::new(),
        data_dir: launch.data_dir.clone(),
        config_dir,
        debug: false,
    };
    let cancel = CancellationToken::new();
    let state = bridge_state(
        config,
        launch.auth.take().expect("prepared authentication"),
        None,
        cancel.clone(),
        Some(launch.control.clone()),
    );
    let signals = cancel_on_signal(cancel.clone());
    let (result, ()) = tokio::join!(
        serve(listener, state, PollConfig::default(), cancel.clone()),
        launch.supervise(cancel)
    );
    signals.abort();
    result.map_err(|e| e.to_string())
}

fn bridge_state(
    config: ServerConfig,
    auth: Auth,
    apps_dir: Option<PathBuf>,
    cancel: CancellationToken,
    launcher: Option<shellboy_studio::launcher::Control>,
) -> shellboy_studio::server::AppState<IpcOwner> {
    let data_dir = &config.data_dir;
    let owner = Arc::new(IpcOwner::new(data_dir.clone()));
    let apps = AppsPaths {
        dir: apps_dir.unwrap_or_else(|| data_dir.join("apps")),
    };
    let mut state = Shared::with_apps(owner, Hub::new(), auth, config, Some(apps), cancel);
    Arc::get_mut(&mut state).expect("new server state").launcher = launcher;
    state
}

fn cancel_on_signal(cancel: CancellationToken) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        #[cfg(unix)]
        async fn terminate() {
            if let Ok(mut term) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                term.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        }
        #[cfg(not(unix))]
        async fn terminate() {
            std::future::pending::<()>().await;
        }
        tokio::select! { _ = terminate() => {}, _ = tokio::signal::ctrl_c() => {} }
        cancel.cancel();
    })
}

async fn run(args: Args) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if matches!(args.command, Some(CliCommand::BundleServer)) {
        return run_bundle_server().await;
    }
    if let Some(CliCommand::Guide { guide }) = args.command {
        print!(
            "{}",
            match guide {
                GuideKind::User => USER_GUIDE,
                GuideKind::Agent => AGENT_GUIDE,
            }
        );
        return Ok(());
    }
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let data_dir =
        resolve_cli_data_dir(args.data_dir.as_deref(), &PathEnvironment::current(), &cwd)
            .map_err(|e| format!("cannot resolve the owner data directory: {e}"))?;
    if let Err(error) = install_agent_guide(&data_dir) {
        eprintln!(
            "shellboy-studio: cannot write the agent guide in {}: {error}",
            data_dir.display()
        );
    }
    let config_dir = match args.config_dir {
        Some(dir) => dir,
        None => default_config_dir()?,
    };
    let auth = if args.no_auth {
        eprintln!(
            "shellboy-studio: WARNING: authentication disabled (--no-auth). Local processes and anyone able to reach this bridge can operate it. Use only local or explicitly trusted private access; NEVER expose it to the public internet (for example via Tailscale Funnel). A VPN is not user authentication. Proxy/VPN exposure is NOT detected or guaranteed."
        );
        Auth::disabled()
    } else {
        Auth::load_or_create(&config_dir)?
    };
    if !args.listen.ip().is_loopback() {
        eprintln!(
            "shellboy-studio: warning: {} is not loopback; traffic is plain HTTP unless a TLS tunnel is in front. Host/Origin checks remain required; authentication depends on --no-auth.",
            args.listen
        );
    }
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .map_err(|e| format!("cannot listen on {}: {e}", args.listen))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    if args.no_auth {
        println!("open http://{addr}/ (NO AUTHENTICATION)");
    } else {
        println!("open http://{addr}/#token={}", auth.token());
    }
    if args.debug {
        if args.no_auth {
            println!("debug page: http://{addr}/debug (NO AUTHENTICATION)");
        } else {
            println!("debug page: http://{addr}/debug#token={}", auth.token());
        }
    }
    let cancel = CancellationToken::new();
    let config = ServerConfig {
        listen: addr,
        extra_hosts: args.allow_host,
        data_dir,
        config_dir,
        debug: args.debug,
    };
    let state = bridge_state(config, auth, args.apps_dir, cancel.clone(), None);
    if let Err(error) = startup_probe(state.owner.as_ref()).await {
        eprintln!("{}", owner_problem(&state.config.data_dir, &error));
    }
    let signals = cancel_on_signal(cancel.clone());
    let result = serve(listener, state, PollConfig::default(), cancel).await;
    signals.abort();
    result.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::owner_problem;
    use shellboy::protocol::{ApiError, ErrorCode};
    use std::path::Path;

    #[test]
    fn installed_guide_is_replaced_on_next_install() {
        let root = std::env::temp_dir().join(format!("studio-guide-{}", uuid::Uuid::new_v4()));
        super::install_agent_guide(&root).unwrap();
        let path = root.join("studio").join("agent-guide.md");
        let pointer = std::fs::read(root.join("studio").join("agent-pointer.md")).unwrap();
        assert!(pointer.len() <= 8192);
        assert!(
            std::str::from_utf8(&pointer)
                .unwrap()
                .contains("agent-guide.md")
        );
        std::fs::write(&path, "edited").unwrap();
        super::install_agent_guide(&root).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), super::AGENT_GUIDE);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn guide_command_accepts_both_bundled_guides() {
        use clap::Parser;
        assert!(super::Args::try_parse_from(["studio", "guide", "user"]).is_ok());
        assert!(super::Args::try_parse_from(["studio", "guide", "agent"]).is_ok());
        assert!(super::Args::try_parse_from(["studio", "guide", "other"]).is_err());
    }

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

#[cfg(test)]
mod no_auth_tests {
    use super::*;
    #[test]
    fn remote_help_uses_generic_hosts_and_keeps_public_exposure_prohibition() {
        use clap::CommandFactory;
        let help = Args::command().render_long_help().to_string();
        assert!(help.contains("HTTPS proxy/VPN"));
        assert!(help.contains("NEVER expose publicly"));
        assert!(!help.contains("tailnet"));
    }

    #[test]
    fn no_auth_is_explicit_and_composes_with_allow_host() {
        assert!(!Args::try_parse_from(["studio"]).unwrap().no_auth);
        let args = Args::try_parse_from([
            "studio",
            "--no-auth",
            "--allow-host",
            "studio.example.ts.net",
        ])
        .unwrap();
        assert!(args.no_auth);
        assert_eq!(args.allow_host, ["studio.example.ts.net"]);
    }
}
