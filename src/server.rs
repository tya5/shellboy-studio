//! HTTP routes. `/debug` is registered only when the debug option is on.
use crate::{
    apps::Apps,
    assets,
    auth::{self, Auth},
    hub::Hub,
    owner::Owner,
    ws,
};
use axum::{
    Router,
    body::Body,
    extract::{Path, State, WebSocketUpgrade, ws::WebSocket},
    http::{HeaderMap, Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

/// Global bound on proxied owner calls (the long-poll is separate). A limit, not a
/// performance claim.
pub const GLOBAL_CALLS: usize = 8;

pub struct ServerConfig {
    pub listen: SocketAddr,
    pub extra_hosts: Vec<String>,
    pub debug: bool,
    /// Which owner this bridge talks to. Shown so two tabs on two bridges can be told apart.
    pub data_dir: PathBuf,
}

/// Where apps live. Without it, the bridge offers no apps.
pub struct AppsPaths {
    pub dir: PathBuf,
}

pub struct Shared<O> {
    pub owner: Arc<O>,
    pub hub: Arc<Hub>,
    pub auth: Auth,
    pub config: ServerConfig,
    pub global: Arc<Semaphore>,
    pub apps: Option<Arc<Apps<O>>>,
    pub cancel: CancellationToken,
}

pub type AppState<O> = Arc<Shared<O>>;

impl<O: Owner> Shared<O> {
    pub fn new(owner: Arc<O>, hub: Arc<Hub>, auth: Auth, config: ServerConfig) -> Arc<Self> {
        Self::with_apps(owner, hub, auth, config, None, CancellationToken::new())
    }

    /// `cancel` also ends the app listeners.
    pub fn with_apps(
        owner: Arc<O>,
        hub: Arc<Hub>,
        auth: Auth,
        config: ServerConfig,
        apps: Option<AppsPaths>,
        cancel: CancellationToken,
    ) -> Arc<Self> {
        let global = Arc::new(Semaphore::new(GLOBAL_CALLS));
        let apps = apps.map(|paths| {
            Apps::new(
                paths.dir,
                owner.clone(),
                hub.clone(),
                global.clone(),
                cancel.clone(),
            )
        });
        Arc::new(Self {
            owner,
            hub,
            auth,
            config,
            global,
            apps,
            cancel,
        })
    }
}

pub fn router<O: Owner>(state: AppState<O>) -> Router {
    let mut router = Router::new()
        .route("/", get(assets::index))
        .route("/assets/{*path}", get(assets::asset))
        .route("/healthz", get(|| async { "ok" }))
        .route("/auth", post(auth_exchange::<O>))
        .route("/pairing", get(pairing_hosts::<O>).post(pairing_issue::<O>))
        .route("/pairing/exchange", post(pairing_exchange::<O>))
        .route("/ws", get(ws_upgrade::<O>));
    if state.config.debug {
        router = router.route("/debug", get(debug_page));
    }
    if state.apps.is_some() {
        router = router
            .route("/a/{session}/{*path}", get(app_file::<O>))
            .route("/_shellboy/api.js", get(|| async { Apps::<O>::api_js() }))
            .route("/_shellboy/ui.css", get(|| async { Apps::<O>::ui_css() }));
    }
    router
        .layer(middleware::from_fn_with_state(
            state.clone(),
            host_guard::<O>,
        ))
        .with_state(state)
}

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

async fn host_guard<O: Owner>(
    State(state): State<AppState<O>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let ok = header_str(request.headers(), header::HOST)
        .is_some_and(|h| auth::host_allowed(h, &state.config.listen, &state.config.extra_hosts));
    if !ok {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    next.run(request).await
}

fn origin_ok(headers: &HeaderMap) -> bool {
    let host = header_str(headers, header::HOST).unwrap_or_default();
    auth::origin_matches(header_str(headers, header::ORIGIN), host)
}

const DEBUG_HTML: &str = include_str!("../web/debug/index.html");

/// The page holds no data and no secret; everything it shows arrives over the
/// authenticated `/ws`. Without a session cookie it only offers the token form.
async fn debug_page() -> impl IntoResponse {
    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'self' 'unsafe-inline'; connect-src 'self'",
            ),
        ],
        Html(DEBUG_HTML),
    )
}

#[derive(Deserialize)]
struct AuthBody {
    token: String,
}

async fn auth_exchange<O: Owner>(
    State(state): State<AppState<O>>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<AuthBody>,
) -> Response {
    if !origin_ok(&headers) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !state.auth.token_matches(&body.token) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    match state.auth.issue_session() {
        Ok(id) => (
            StatusCode::NO_CONTENT,
            [(
                header::SET_COOKIE,
                format!(
                    "{}={id}; HttpOnly; SameSite=Strict; Path=/",
                    auth::cookie_name(state.config.listen.port())
                ),
            )],
        )
            .into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "no random source").into_response(),
    }
}

fn authorized<O: Owner>(state: &AppState<O>, headers: &HeaderMap) -> bool {
    origin_ok(headers)
        && state.auth.cookie_valid(
            &auth::cookie_name(state.config.listen.port()),
            header_str(headers, header::COOKIE),
        )
}

async fn pairing_hosts<O: Owner>(State(state): State<AppState<O>>, headers: HeaderMap) -> Response {
    if !authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let hosts: Vec<_> = state
        .config
        .extra_hosts
        .iter()
        .filter(|h| auth::pairing_host(h))
        .collect();
    (
        [(header::CACHE_CONTROL, "no-store")],
        axum::Json(serde_json::json!({"hosts": hosts})),
    )
        .into_response()
}

#[derive(Deserialize)]
struct PairingHost {
    host: String,
}
async fn pairing_issue<O: Owner>(
    State(state): State<AppState<O>>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<PairingHost>,
) -> Response {
    if !authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !auth::pairing_host(&body.host)
        || !state
            .config
            .extra_hosts
            .iter()
            .any(|h| h.eq_ignore_ascii_case(&body.host))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match state.auth.issue_pairing() {
        Ok(code) => ([(header::CACHE_CONTROL, "no-store")], axum::Json(serde_json::json!({"url": format!("https://{}/#pair={code}", body.host), "expires_in_seconds": auth::PAIRING_TTL.as_secs()}))).into_response(),
        Err(_) => StatusCode::TOO_MANY_REQUESTS.into_response(),
    }
}

#[derive(Deserialize)]
struct PairingCode {
    code: String,
}
async fn pairing_exchange<O: Owner>(
    State(state): State<AppState<O>>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<PairingCode>,
) -> Response {
    if !origin_ok(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !state.auth.consume_pairing(&body.code) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match state.auth.issue_session() {
        Ok(id) => (
            StatusCode::NO_CONTENT,
            [
                (
                    header::SET_COOKIE,
                    format!(
                        "{}={id}; HttpOnly; SameSite=Strict; Path=/",
                        auth::cookie_name(state.config.listen.port())
                    ),
                ),
                (header::CACHE_CONTROL, "no-store".to_owned()),
            ],
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// The path's session is the capability: a sandboxed page sends no cookies.
async fn app_file<O: Owner>(
    State(state): State<AppState<O>>,
    Path((session, path)): Path<(String, String)>,
    method: Method,
) -> Response {
    match &state.apps {
        Some(apps) => apps.file(&session, &path, &method).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ws_upgrade<O: Owner>(
    State(state): State<AppState<O>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !origin_ok(&headers) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    if !state.auth.cookie_valid(
        &auth::cookie_name(state.config.listen.port()),
        header_str(&headers, header::COOKIE),
    ) {
        return (StatusCode::UNAUTHORIZED, "no session").into_response();
    }
    let Some((guard, owner_state)) = state.hub.register() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "too many sessions").into_response();
    };
    upgrade
        .max_message_size(ws::MAX_CLIENT_FRAME)
        .max_frame_size(ws::MAX_CLIENT_FRAME)
        .on_upgrade(move |socket: WebSocket| ws::session(socket, state, guard, owner_state))
}

/// Run the bridge until `cancel` fires: the HTTP server and the one `events.wait` loop.
/// Both end on cancellation; open WebSockets are dropped with the server.
pub async fn serve<O: Owner>(
    listener: tokio::net::TcpListener,
    state: AppState<O>,
    poll: crate::events::PollConfig,
    cancel: tokio_util::sync::CancellationToken,
) -> std::io::Result<()> {
    // `serve` owns stopping: the same token ends the app listeners.
    let inner = state.cancel.clone();
    let linked = cancel.clone();
    tokio::spawn(async move {
        linked.cancelled().await;
        inner.cancel();
    });
    let apps = state.apps.clone();
    let poller = tokio::spawn(crate::events::run(
        state.owner.clone(),
        state.hub.clone(),
        poll,
        cancel.clone(),
    ));
    let shutdown = cancel.clone();
    let result = axum::serve(listener, router(state))
        .with_graceful_shutdown(async move { shutdown.cancelled().await })
        .await;
    cancel.cancel();
    let _ = poller.await;
    if let Some(apps) = apps {
        apps.stopped().await;
    }
    result
}
