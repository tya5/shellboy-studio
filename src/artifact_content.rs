//! Authenticated content for the exact owner-selected artifact version.
use crate::{owner::Owner, server::AppState};
use axum::{
    Extension, Json,
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

pub(crate) fn reveal_route<O: Owner>() -> axum::routing::MethodRouter<AppState<O>> {
    reveal_route_with::<O, _>(SystemRunner)
}

fn reveal_route_with<O: Owner, R: RevealRunner>(
    runner: R,
) -> axum::routing::MethodRouter<AppState<O>> {
    axum::routing::get(reveal_capability::<O>)
        .post(reveal::<O, R>)
        .layer(Extension(runner))
}

async fn reveal<O: Owner, R: RevealRunner>(
    State(state): State<AppState<O>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Extension(runner): Extension<R>,
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
    reveal_response(&runner, platform, &path).await
}

async fn reveal_response(runner: &impl RevealRunner, platform: Platform, path: &Path) -> Response {
    match run_reveal(runner, platform, path).await {
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

trait RevealRunner: Clone + Send + Sync + 'static {
    fn explorer_path(&self) -> Option<PathBuf> {
        None
    }
    fn run(
        &self,
        program: &Path,
        args: &[std::ffi::OsString],
    ) -> impl std::future::Future<Output = std::io::Result<std::process::ExitStatus>> + Send;
}

#[derive(Clone, Copy)]
struct SystemRunner;
impl RevealRunner for SystemRunner {
    #[cfg(windows)]
    fn explorer_path(&self) -> Option<PathBuf> {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt};
        use windows_sys::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;
        let mut buffer = [0u16; 260];
        // Query the OS, not the inherited environment or executable search path.
        let len = unsafe { GetSystemWindowsDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) }
            as usize;
        if len == 0 || len >= buffer.len() {
            return None;
        }
        let dir = PathBuf::from(OsString::from_wide(&buffer[..len]));
        dir.is_absolute().then(|| dir.join("explorer.exe"))
    }

    async fn run(
        &self,
        program: &Path,
        args: &[std::ffi::OsString],
    ) -> std::io::Result<std::process::ExitStatus> {
        use std::process::Stdio;
        tokio::process::Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status()
            .await
    }
}

async fn run_reveal(runner: &impl RevealRunner, platform: Platform, path: &Path) -> Result<(), ()> {
    let (program, args) = match platform {
        Platform::Mac => (
            PathBuf::from("/usr/bin/open"),
            vec!["-R".into(), path.into()],
        ),
        Platform::Windows => {
            let mut selection = std::ffi::OsString::from("/select,");
            selection.push(path);
            (
                runner
                    .explorer_path()
                    .filter(|path| path.is_absolute())
                    .ok_or(())?,
                vec![selection],
            )
        }
        Platform::Linux => (
            PathBuf::from("/usr/bin/xdg-open"),
            vec![path.parent().ok_or(())?.into()],
        ),
    };
    let status = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        runner.run(&program, &args),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    // Explorer can return 1 after successfully opening the requested location.
    (matches!(platform, Platform::Windows) || status.success())
        .then_some(())
        .ok_or(())
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

    #[tokio::test]
    async fn reveal_post_refuses_nonlocal_owner_and_mismatched_results() {
        use crate::{
            auth::Auth,
            hub::Hub,
            server::{ServerConfig, Shared},
        };
        use axum::{Router, body::to_bytes, http::Request};
        use serde_json::{Value, json};
        use shellboy::protocol::{ApiError, Origin, Response as OwnerResponse};
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        use tower::ServiceExt;

        struct FakeOwner {
            local: bool,
            result: Value,
            reads: AtomicUsize,
        }
        impl Owner for FakeOwner {
            fn is_local_ipc(&self) -> bool {
                self.local
            }
            async fn call(
                &self,
                cmd: Command,
                operation: Option<String>,
                origin: Option<Origin>,
            ) -> Result<OwnerResponse<Value>, ApiError> {
                let Command::ArtifactGet(args) = cmd else {
                    panic!("expected artifact.get")
                };
                assert_eq!(args.artifact_id, "report");
                assert_eq!(args.version, Some(2));
                assert!(operation.is_none() && origin.is_none());
                self.reads.fetch_add(1, Ordering::Relaxed);
                Ok(OwnerResponse::success("fixture", self.result.clone()))
            }
        }
        #[derive(Clone)]
        struct NeverRunner;
        impl RevealRunner for NeverRunner {
            fn explorer_path(&self) -> Option<PathBuf> {
                panic!("refusal reached runner")
            }
            async fn run(
                &self,
                _: &Path,
                _: &[OsString],
            ) -> std::io::Result<std::process::ExitStatus> {
                panic!("refusal reached runner")
            }
        }
        for (local, thread, artifact, version, status, code) in [
            (
                false,
                "lead",
                "report",
                2,
                StatusCode::FORBIDDEN,
                "not_local",
            ),
            (
                true,
                "other",
                "report",
                2,
                StatusCode::NOT_FOUND,
                "unknown_artifact",
            ),
            (
                true,
                "lead",
                "other",
                2,
                StatusCode::NOT_FOUND,
                "unknown_artifact",
            ),
            (
                true,
                "lead",
                "report",
                3,
                StatusCode::NOT_FOUND,
                "unknown_artifact",
            ),
            (
                true,
                "lead",
                "report",
                2,
                StatusCode::NOT_FOUND,
                "file_unavailable",
            ),
        ] {
            let owner = Arc::new(FakeOwner {
                local,
                reads: AtomicUsize::new(0),
                result: json!({
                    "thread_id": thread, "artifact_id": artifact, "created_at": "fixture", "updated_at": "fixture",
                    "version": {"version": version, "uri": "https://example.invalid/report", "title": "Report", "mime": null, "created_at": "fixture"},
                }),
            });
            let auth = Auth::new("fixture".into());
            let cookie = format!(
                "{}={}",
                crate::auth::cookie_name(8751),
                auth.issue_session().unwrap()
            );
            let state = Shared::new(
                owner.clone(),
                Hub::new(),
                auth,
                ServerConfig {
                    listen: "127.0.0.1:8751".parse().unwrap(),
                    extra_hosts: vec![],
                    debug: false,
                    data_dir: PathBuf::new(),
                    config_dir: PathBuf::new(),
                },
            );
            let mut req = Request::post("/artifact-reveal")
                .header(header::HOST, "127.0.0.1:8751")
                .header(header::ORIGIN, "http://127.0.0.1:8751")
                .header(header::COOKIE, cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"thread_id":"lead","artifact_id":"report","version":2}"#,
                ))
                .unwrap();
            req.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:50000".parse::<SocketAddr>().unwrap(),
            ));
            let response = Router::new()
                .route("/artifact-reveal", reveal_route_with(NeverRunner))
                .with_state(state)
                .oneshot(req)
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            let body = to_bytes(response.into_body(), 512).await.unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap(),
                json!({"code":code})
            );
            assert_eq!(owner.reads.load(Ordering::Relaxed), usize::from(local));
        }
    }

    #[derive(Clone)]
    struct RecordingRunner(&'static str, Vec<OsString>);
    impl RevealRunner for RecordingRunner {
        fn explorer_path(&self) -> Option<PathBuf> {
            Some(std::env::temp_dir().join("Windows").join("explorer.exe"))
        }

        async fn run(
            &self,
            program: &Path,
            args: &[OsString],
        ) -> std::io::Result<std::process::ExitStatus> {
            let expected = if self.0 == "explorer" {
                self.explorer_path().unwrap()
            } else {
                PathBuf::from(self.0)
            };
            assert_eq!(program, expected);
            assert_eq!(args, self.1);
            Ok(exit_status(0))
        }
    }

    fn exit_status(code: u8) -> std::process::ExitStatus {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        #[cfg(unix)]
        let raw = i32::from(code) << 8;
        #[cfg(windows)]
        let raw = u32::from(code);
        std::process::ExitStatus::from_raw(raw)
    }

    #[tokio::test]
    async fn reveal_windows_ignores_exit_code_but_not_spawn_error() {
        use axum::body::to_bytes;

        #[derive(Clone)]
        struct Runner(bool);
        impl RevealRunner for Runner {
            fn explorer_path(&self) -> Option<PathBuf> {
                Some(std::env::temp_dir().join("explorer.exe"))
            }

            async fn run(
                &self,
                _: &Path,
                _: &[OsString],
            ) -> std::io::Result<std::process::ExitStatus> {
                if self.0 {
                    Ok(exit_status(1))
                } else {
                    Err(std::io::ErrorKind::NotFound.into())
                }
            }
        }
        let path = Path::new("/fixture/report.txt");
        assert_eq!(
            reveal_response(&Runner(true), Platform::Windows, path)
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        for (runner, platform) in [
            (Runner(false), Platform::Windows),
            (Runner(true), Platform::Mac),
            (Runner(true), Platform::Linux),
        ] {
            let response = reveal_response(&runner, platform, path).await;
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
            let body = to_bytes(response.into_body(), 512).await.unwrap();
            assert_eq!(body.as_ref(), br#"{"code":"reveal_failed"}"#);
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
                "explorer",
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
