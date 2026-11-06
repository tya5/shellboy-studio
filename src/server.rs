//! HTTP routes. `/debug` is registered only when the debug option is on.
use crate::{
    auth::{self, Auth, COOKIE_NAME},
    hub::Hub,
    owner::Owner,
    ws,
};
use axum::{
    Router,
    body::Body,
    extract::{State, WebSocketUpgrade, ws::WebSocket},
    http::{HeaderMap, Request, StatusCode, header},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use std::{net::SocketAddr, sync::Arc};
use tokio::sync::Semaphore;

/// Global bound on proxied owner calls (the long-poll is separate). A limit, not a
/// performance claim.
pub const GLOBAL_CALLS: usize = 8;

pub struct ServerConfig {
    pub listen: SocketAddr,
    pub extra_hosts: Vec<String>,
    pub debug: bool,
}

pub struct Shared<O> {
    pub owner: Arc<O>,
    pub hub: Arc<Hub>,
    pub auth: Auth,
    pub config: ServerConfig,
    pub global: Arc<Semaphore>,
}

pub type AppState<O> = Arc<Shared<O>>;

impl<O> Shared<O> {
    pub fn new(owner: Arc<O>, hub: Arc<Hub>, auth: Auth, config: ServerConfig) -> Arc<Self> {
        Arc::new(Self {
            owner,
            hub,
            auth,
            config,
            global: Arc::new(Semaphore::new(GLOBAL_CALLS)),
        })
    }
}

pub fn router<O: Owner>(state: AppState<O>) -> Router {
    let mut router = Router::new()
        .route("/", get(index))
        .route("/healthz", get(|| async { "ok" }))
        .route("/auth", post(auth_exchange::<O>))
        .route("/ws", get(ws_upgrade::<O>));
    if state.config.debug {
        router = router.route("/debug", get(debug_page));
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

async fn index() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "shellboy-web bridge. The production frontend is not built yet.\n",
    )
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
                format!("{COOKIE_NAME}={id}; HttpOnly; SameSite=Strict; Path=/"),
            )],
        )
            .into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "no random source").into_response(),
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
    if !state
        .auth
        .cookie_valid(header_str(&headers, header::COOKIE))
    {
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
    result
}
