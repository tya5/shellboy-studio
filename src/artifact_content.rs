//! Authenticated content for the exact owner-selected artifact version.
use crate::{owner::Owner, server::AppState};
use axum::{
    Json,
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use shellboy::protocol::{
    ArtifactGetArgs, ArtifactSelected, Command, ConfigGetArgs, PROTOCOL_VERSION,
};
use std::{
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
    let result = read(
        &state,
        Command::ArtifactGet(ArtifactGetArgs {
            artifact_id: target.artifact_id.clone(),
            version: Some(target.version),
            cursor: None,
            limit: None,
        }),
    )
    .await;
    let Some(version) =
        result.and_then(|value| serde_json::from_value::<ArtifactSelected>(value).ok())
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if version.thread_id != target.thread_id
        || version.artifact_id != target.artifact_id
        || version.version.version != target.version
    {
        return StatusCode::NOT_FOUND.into_response();
    }
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
