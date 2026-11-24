//! Authenticated content for the exact owner-selected artifact version.
use crate::{owner::Owner, server::AppState};
use axum::{
    Json,
    body::Body,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use shellboy::protocol::{
    ArtifactGetArgs, ArtifactSelected, Command, ConfigGetArgs, PROTOCOL_VERSION,
};
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    pin::Pin,
    task::{Context, Poll},
};
use tokio::{
    fs::File,
    io::{AsyncRead, AsyncReadExt, ReadBuf, Take},
    sync::OwnedSemaphorePermit,
};
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    thread_id: String,
    artifact_id: String,
    version: i64,
    action: Action,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Preview,
    Open,
}

fn mime_type(mime: &str) -> &str {
    mime.split(';').next().unwrap_or_default().trim()
}

fn preview_type(mime: &str) -> bool {
    let mime = mime_type(mime);
    mime.get(..6)
        .is_some_and(|p| p.eq_ignore_ascii_case("image/"))
        && mime.len() > 6
        || mime
            .get(..5)
            .is_some_and(|p| p.eq_ignore_ascii_case("text/"))
            && mime.len() > 5
            && !mime.eq_ignore_ascii_case("text/html")
}

fn open_type(mime: &str) -> bool {
    preview_type(mime)
        || mime_type(mime).eq_ignore_ascii_case("text/html")
        || mime_type(mime).eq_ignore_ascii_case("application/pdf")
}

fn local_path(uri: &str) -> Option<PathBuf> {
    let path = if Path::new(uri).is_absolute() {
        PathBuf::from(uri)
    } else {
        let parsed = url::Url::parse(uri).ok()?;
        if parsed.scheme() != "file"
            || parsed.host_str().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return None;
        }
        parsed.to_file_path().ok()?
    };
    if !path.is_absolute() || path.to_str()?.contains('\0') {
        return None;
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(p)) if matches!(p.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return None;
    }
    Some(path)
}

async fn read<O: Owner>(state: &AppState<O>, command: Command) -> Option<serde_json::Value> {
    let reply = state.owner.call(command, None, None).await.ok()?;
    (reply.ok && reply.protocol_version == PROTOCOL_VERSION)
        .then_some(reply.result)
        .flatten()
}

pub(crate) async fn content<O: Owner>(
    State(state): State<AppState<O>>,
    headers: HeaderMap,
    Json(target): Json<Target>,
) -> Response {
    if !crate::server::authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if target.version < 1
        || target.thread_id.is_empty()
        || target.artifact_id.is_empty()
        || matches!(target.action, Action::Open) && state.launcher.is_none()
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(permit) = state.global.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let Some(version) = resolve(
        &state,
        &target.thread_id,
        &target.artifact_id,
        target.version,
    )
    .await
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(path) = local_path(&version.version.uri) else {
        return StatusCode::NO_CONTENT.into_response();
    };
    let Some(mime) = version.version.mime else {
        return StatusCode::NO_CONTENT.into_response();
    };
    match target.action {
        Action::Preview if preview_type(&mime) => preview(&state, &path, permit).await,
        Action::Open if open_type(&mime) => open_file(&path).await,
        _ => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn resolve<O: Owner>(
    state: &AppState<O>,
    thread: &str,
    artifact: &str,
    version: i64,
) -> Option<ArtifactSelected> {
    let value = read(
        state,
        Command::ArtifactGet(ArtifactGetArgs {
            artifact_id: artifact.into(),
            version: Some(version),
            cursor: None,
            limit: None,
        }),
    )
    .await?;
    let selected: ArtifactSelected = serde_json::from_value(value).ok()?;
    (selected.thread_id == thread
        && selected.artifact_id == artifact
        && selected.version.version == version)
        .then_some(selected)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RevealTarget {
    thread_id: String,
    artifact_id: String,
    version: i64,
}

#[derive(Clone, Copy)]
enum Platform {
    Mac,
    Windows,
    Linux,
}

impl Platform {
    fn current() -> Option<Self> {
        match std::env::consts::OS {
            "macos" => Some(Self::Mac),
            "windows" => Some(Self::Windows),
            "linux" => Some(Self::Linux),
            _ => None,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Mac => "finder",
            Self::Windows => "explorer",
            Self::Linux => "folder",
        }
    }
}

fn direct_local(
    listen: SocketAddr,
    peer: Option<SocketAddr>,
    headers: &HeaderMap,
    mutation: bool,
) -> bool {
    let authority = listen.to_string();
    let origin = format!("http://{authority}");
    listen.ip().is_loopback()
        && peer.is_some_and(|peer| peer.ip().is_loopback())
        && headers
            .get(header::HOST)
            .is_some_and(|value| value == authority.as_str())
        && ![
            "forwarded",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
        ]
        .iter()
        .any(|key| headers.contains_key(*key))
        && if mutation {
            headers
                .get(header::ORIGIN)
                .is_some_and(|value| value == origin.as_str())
        } else {
            headers
                .get(header::ORIGIN)
                .is_none_or(|value| value == origin.as_str())
        }
}

fn reveal_platform<O: Owner>(
    state: &AppState<O>,
    peer: SocketAddr,
    headers: &HeaderMap,
    mutation: bool,
) -> Option<Platform> {
    if state.auth.is_disabled()
        || !state.owner.is_local_ipc()
        || !state.config.extra_hosts.is_empty()
        || !direct_local(state.config.listen, Some(peer), headers, mutation)
        || !crate::server::authorized(state, headers)
    {
        return None;
    }
    Platform::current()
}

pub(crate) async fn reveal_capability<O: Owner>(
    State(state): State<AppState<O>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            "platform": reveal_platform(&state, peer, &headers, false).map(Platform::label),
        })),
    )
        .into_response()
}

fn reveal_error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "code": code }))).into_response()
}

pub(crate) async fn reveal<O: Owner>(
    State(state): State<AppState<O>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(target): Json<RevealTarget>,
) -> Response {
    let Some(platform) = reveal_platform(&state, peer, &headers, true) else {
        return reveal_error(StatusCode::FORBIDDEN, "not_local");
    };
    if target.version < 1 || target.thread_id.is_empty() || target.artifact_id.is_empty() {
        return reveal_error(StatusCode::NOT_FOUND, "unknown_artifact");
    }
    let Ok(_permit) = state.global.clone().try_acquire_owned() else {
        return reveal_error(StatusCode::SERVICE_UNAVAILABLE, "busy");
    };
    let Some(selected) = resolve(
        &state,
        &target.thread_id,
        &target.artifact_id,
        target.version,
    )
    .await
    else {
        return reveal_error(StatusCode::NOT_FOUND, "unknown_artifact");
    };
    let Some(path) = reveal_path(&selected.version.uri).await else {
        return reveal_error(StatusCode::NOT_FOUND, "file_unavailable");
    };
    match run_reveal(&SystemRunner, platform, &path).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(()) => reveal_error(StatusCode::BAD_GATEWAY, "reveal_failed"),
    }
}

async fn reveal_path(uri: &str) -> Option<PathBuf> {
    let path = local_path(uri)?;
    let canonical = tokio::fs::canonicalize(&path).await.ok()?;
    // Do not redirect a registered path through a symlink or traversal into another location.
    #[cfg(windows)]
    let canonical = PathBuf::from(canonical.to_str()?.strip_prefix(r"\\?\")?);
    if path != canonical || !tokio::fs::metadata(&canonical).await.ok()?.is_file() {
        return None;
    }
    Some(canonical)
}

trait RevealRunner {
    async fn run(&self, program: &str, args: &[std::ffi::OsString]) -> Result<(), ()>;
}

struct SystemRunner;
impl RevealRunner for SystemRunner {
    async fn run(&self, program: &str, args: &[std::ffi::OsString]) -> Result<(), ()> {
        use std::process::Stdio;
        tokio::process::Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status()
            .await
            .map_err(|_| ())?
            .success()
            .then_some(())
            .ok_or(())
    }
}

async fn run_reveal(runner: &impl RevealRunner, platform: Platform, path: &Path) -> Result<(), ()> {
    let (program, args) = match platform {
        Platform::Mac => ("/usr/bin/open", vec!["-R".into(), path.into()]),
        Platform::Windows => {
            let mut selection = std::ffi::OsString::from("/select,");
            selection.push(path);
            ("explorer.exe", vec![selection])
        }
        Platform::Linux => ("/usr/bin/xdg-open", vec![path.parent().ok_or(())?.into()]),
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        runner.run(program, &args),
    )
    .await
    .map_err(|_| ())?
}

// Keep the same shared permit until the body finishes or the browser cancels.
struct BoundedFile {
    file: Take<File>,
    _permit: OwnedSemaphorePermit,
}
impl AsyncRead for BoundedFile {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.file).poll_read(cx, buf)
    }
}

async fn preview<O: Owner>(
    state: &AppState<O>,
    path: &Path,
    permit: OwnedSemaphorePermit,
) -> Response {
    let config = read(state, Command::ConfigGet(ConfigGetArgs {})).await;
    let unavailable = StatusCode::NO_CONTENT;
    let Some(limit) = config
        .as_ref()
        .and_then(|result| result.pointer("/loaded/values/limits/attachment_file_bytes"))
        .and_then(serde_json::Value::as_u64)
        .filter(|n| *n > 0)
    else {
        return unavailable.into_response();
    };
    if !tokio::fs::metadata(path)
        .await
        .is_ok_and(|meta| meta.is_file() && meta.len() <= limit)
    {
        return unavailable.into_response();
    }
    let mut opts = tokio::fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    opts.custom_flags(libc::O_NONBLOCK);
    let Ok(file) = opts.open(path).await else {
        return unavailable.into_response();
    };
    let Ok(meta) = file.metadata().await else {
        return unavailable.into_response();
    };
    if !meta.is_file() || meta.len() > limit {
        return unavailable.into_response();
    }
    let stream = ReaderStream::new(BoundedFile {
        file: file.take(meta.len()),
        _permit: permit,
    });
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'",
            ),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

async fn open_file(path: &Path) -> Response {
    if !tokio::fs::metadata(path).await.is_ok_and(|m| m.is_file()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if crate::launcher::open_artifact_file(path).await.is_ok() {
        StatusCode::OK.into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

#[cfg(test)]
mod reveal_tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn reveal_accepts_only_exact_direct_local_requests() {
        let listen = "127.0.0.1:8751".parse().unwrap();
        let local = Some("127.0.0.1:50000".parse().unwrap());
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "127.0.0.1:8751".parse().unwrap());
        assert!(direct_local(listen, local, &headers, false));
        assert!(!direct_local(listen, local, &headers, true));
        headers.insert(header::ORIGIN, "http://127.0.0.1:8751".parse().unwrap());
        assert!(direct_local(listen, local, &headers, true));
        assert!(!direct_local(listen, None, &headers, true));
        assert!(!direct_local(
            listen,
            Some("192.0.2.1:50000".parse().unwrap()),
            &headers,
            true
        ));
        headers.insert("x-forwarded-for", "192.0.2.1".parse().unwrap());
        assert!(!direct_local(listen, local, &headers, true));
        headers.remove("x-forwarded-for");
        headers.insert(header::ORIGIN, "https://example.test".parse().unwrap());
        assert!(!direct_local(listen, local, &headers, true));
    }

    #[test]
    fn reveal_rejects_client_paths() {
        let json = serde_json::json!({"thread_id":"lead","artifact_id":"report","version":1,"path":"/not/the/artifact"});
        assert!(serde_json::from_value::<RevealTarget>(json).is_err());
    }

    struct RecordingRunner(&'static str, Vec<OsString>);
    impl RevealRunner for RecordingRunner {
        async fn run(&self, program: &str, args: &[OsString]) -> Result<(), ()> {
            assert_eq!(program, self.0);
            assert_eq!(args, self.1);
            Ok(())
        }
    }

    #[tokio::test]
    async fn reveal_builds_file_manager_arguments_without_a_shell() {
        let file = Path::new("/fixture/my reports/example;notes.txt");
        for (platform, program, args) in [
            (
                Platform::Mac,
                "/usr/bin/open",
                vec!["-R".into(), file.into()],
            ),
            (
                Platform::Linux,
                "/usr/bin/xdg-open",
                vec![file.parent().unwrap().into()],
            ),
        ] {
            run_reveal(&RecordingRunner(program, args), platform, file)
                .await
                .unwrap();
        }
        run_reveal(
            &RecordingRunner(
                "explorer.exe",
                vec![r"/select,C:\my reports\example.txt".into()],
            ),
            Platform::Windows,
            Path::new(r"C:\my reports\example.txt"),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn reveal_requires_a_canonical_regular_file_and_refuses_redirects() {
        let temp = std::env::temp_dir().join(format!(
            "studio-reveal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&temp).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(temp.clone());
        let root = std::fs::canonicalize(temp).unwrap();
        #[cfg(windows)]
        let root = PathBuf::from(root.to_str().unwrap().strip_prefix(r"\\?\").unwrap());
        let inside = root.join("registered");
        std::fs::create_dir(&inside).unwrap();
        let file = inside.join("report.txt");
        let outside = root.join("outside.txt");
        std::fs::write(&file, "synthetic").unwrap();
        std::fs::write(&outside, "synthetic").unwrap();
        assert_eq!(reveal_path(file.to_str().unwrap()).await, Some(file));
        assert!(reveal_path(inside.to_str().unwrap()).await.is_none());
        assert!(
            reveal_path(inside.join("missing.txt").to_str().unwrap())
                .await
                .is_none()
        );
        assert!(
            reveal_path(inside.join("../outside.txt").to_str().unwrap())
                .await
                .is_none()
        );
        #[cfg(unix)]
        {
            let redirect = inside.join("link.txt");
            std::os::unix::fs::symlink(outside, &redirect).unwrap();
            assert!(reveal_path(redirect.to_str().unwrap()).await.is_none());
        }
    }
}
