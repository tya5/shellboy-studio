//! HTTP, auth and WebSocket behaviour against a mock owner.
mod common;
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use common::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use tower::ServiceExt;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(
    addr: std::net::SocketAddr,
    cookie: Option<&str>,
    origin: Option<&str>,
) -> Result<Ws, tokio_tungstenite::tungstenite::Error> {
    let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
    }
    if let Some(cookie) = cookie {
        request
            .headers_mut()
            .insert("cookie", cookie.parse().unwrap());
    }
    tokio_tungstenite::connect_async(request)
        .await
        .map(|(ws, _)| ws)
}

async fn next(ws: &mut Ws) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("frame in time")
            .expect("socket open")
            .expect("ws ok");
        if let Message::Text(text) = message {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

/// Next frame whose `t` matches; other frames are skipped.
async fn next_t(ws: &mut Ws, t: &str) -> Value {
    loop {
        let frame = next(ws).await;
        if frame["t"] == t {
            return frame;
        }
    }
}

async fn put(ws: &mut Ws, value: Value) {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}

fn status_of(error: tokio_tungstenite::tungstenite::Error) -> u16 {
    match error {
        tokio_tungstenite::tungstenite::Error::Http(response) => response.status().as_u16(),
        other => panic!("expected an HTTP refusal, got {other:?}"),
    }
}

fn list_handler(command: &shellboy::protocol::Command) -> Option<Value> {
    use shellboy::protocol::Command;
    match command {
        Command::ThreadList(_) => Some(json!({"items": []})),
        Command::ThreadCreate(_) => Some(json!({"thread_id": "t-new"})),
        Command::MessageSend(_) => Some(json!({"accepted": true})),
        _ => None, // hangs: used to hold calls open
    }
}

#[tokio::test]
async fn http_guards_host_origin_token_and_debug_route() {
    let (owner, _tx) = mock(list_handler);
    let get = |app: axum::Router, uri: &str, host: &str| {
        let request = Request::get(uri)
            .header(header::HOST, host)
            .body(Body::empty())
            .unwrap();
        async move { app.oneshot(request).await.unwrap().status() }
    };
    let off = router_only(owner.clone(), false);
    assert_eq!(
        get(off.clone(), "/healthz", "127.0.0.1:8751").await,
        StatusCode::OK
    );
    assert_eq!(
        get(off.clone(), "/healthz", "evil.example").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get(off.clone(), "/debug", "127.0.0.1:8751").await,
        StatusCode::NOT_FOUND,
        "off by default"
    );
    let on = router_only(owner.clone(), true);
    assert_eq!(
        get(on.clone(), "/debug", "localhost:8751").await,
        StatusCode::OK
    );

    let post = |app: axum::Router, token: &str, origin: Option<&str>| {
        let mut request = Request::post("/auth")
            .header(header::HOST, "127.0.0.1:8751")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        let request = request
            .body(Body::from(json!({"token": token}).to_string()))
            .unwrap();
        async move { app.oneshot(request).await.unwrap() }
    };
    assert_eq!(
        post(off.clone(), "wrong", None).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let good = "ab".repeat(32);
    assert_eq!(
        post(off.clone(), &good, Some("http://evil.example"))
            .await
            .status(),
        StatusCode::FORBIDDEN,
        "cross-origin exchange is refused even with the right token"
    );
    let ok = post(off, &good, Some("http://127.0.0.1:8751")).await;
    assert_eq!(ok.status(), StatusCode::NO_CONTENT);
    let cookie = ok.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"),
        "{cookie}"
    );
}

#[tokio::test]
async fn serves_the_frontend_with_a_strict_policy_or_says_how_to_build_it() {
    let (owner, _tx) = mock(list_handler);
    let app = router_only(owner, false);
    let request = |uri: &str| {
        Request::get(uri)
            .header(header::HOST, "127.0.0.1:8751")
            .body(Body::empty())
            .unwrap()
    };
    let index = app.clone().oneshot(request("/")).await.unwrap();
    if shellboy_studio::assets::EMBEDDED.is_empty() {
        assert_eq!(index.status(), StatusCode::SERVICE_UNAVAILABLE);
    } else {
        assert_eq!(index.status(), StatusCode::OK);
        assert_eq!(index.headers()[header::CACHE_CONTROL], "no-cache");
        let policy = index.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(policy.contains("default-src 'none'"));
        let (path, _) = shellboy_studio::assets::EMBEDDED
            .iter()
            .find(|(p, _)| p.starts_with("assets/"))
            .expect("a hashed asset");
        let asset = app
            .clone()
            .oneshot(request(&format!("/{path}")))
            .await
            .unwrap();
        assert_eq!(asset.status(), StatusCode::OK);
        assert!(
            asset.headers()[header::CACHE_CONTROL]
                .to_str()
                .unwrap()
                .contains("immutable")
        );
    }
    let missing = app.oneshot(request("/assets/none.js")).await.unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn two_bridges_on_one_host_keep_their_own_sessions() {
    let (a_owner, _a) = mock(list_handler);
    let (b_owner, _b) = mock(list_handler);
    let (a, a_state, a_cancel) = start(a_owner, false).await;
    let (b, b_state, b_cancel) = start(b_owner, false).await;
    let a_cookie = login(a, &a_state).await;
    let b_cookie = login(b, &b_state).await;
    assert_ne!(
        a_cookie.split_once('=').unwrap().0,
        b_cookie.split_once('=').unwrap().0
    );
    // A browser holds both, since cookies ignore ports, and sends both to each.
    let both = format!("{a_cookie}; {b_cookie}");
    for addr in [a, b] {
        let origin = format!("http://{addr}");
        assert!(
            connect(addr, Some(&both), Some(&origin)).await.is_ok(),
            "{addr}"
        );
    }
    // Each session belongs to the bridge that issued it, even under the other's name.
    let a_value = a_cookie.split_once('=').unwrap().1;
    let wrong = format!("{}={a_value}", b_cookie.split_once('=').unwrap().0);
    let origin = format!("http://{b}");
    assert_eq!(
        status_of(connect(b, Some(&wrong), Some(&origin)).await.err().unwrap()),
        401
    );
    a_cancel.cancel();
    b_cancel.cancel();
}

#[tokio::test]
async fn websocket_requires_a_session_and_a_matching_origin() {
    let (owner, _tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner, false).await;
    let origin = format!("http://{addr}");
    assert_eq!(
        status_of(connect(addr, None, Some(&origin)).await.err().unwrap()),
        401
    );
    assert_eq!(
        status_of(
            connect(addr, Some("sbw_session=nope"), Some(&origin))
                .await
                .err()
                .unwrap()
        ),
        401
    );
    let cookie = login(addr, &state).await;
    assert_eq!(
        status_of(
            connect(addr, Some(&cookie), Some("http://evil.example"))
                .await
                .err()
                .unwrap()
        ),
        403,
        "cross-site WebSocket hijacking is refused"
    );
    let mut ws = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    let hello = next(&mut ws).await;
    assert_eq!(hello["t"], "hello");
    assert_eq!(hello["data_dir"], "/temp/data");
    assert_eq!(hello["bridge_version"], env!("CARGO_PKG_VERSION"));
    cancel.cancel();
}

#[tokio::test]
async fn proxies_calls_enforces_the_allowlist_and_marks_web_sends() {
    let (owner, _tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner.clone(), false).await;
    let cookie = login(addr, &state).await;
    let mut ws = connect(addr, Some(&cookie), Some(&format!("http://{addr}")))
        .await
        .unwrap();
    next_t(&mut ws, "hello").await;

    put(
        &mut ws,
        json!({"t":"call","id":1,"command":"thread.list","args":{}}),
    )
    .await;
    let result = next_t(&mut ws, "result").await;
    assert_eq!(result["id"], 1);
    assert_eq!(
        result["response"]["ok"], true,
        "owner Response passes through verbatim: {result}"
    );
    assert_eq!(result["response"]["result"], json!({"items": []}));

    put(
        &mut ws,
        json!({"t":"call","id":2,"command":"owner.shutdown","args":{"instance_id":"x"}}),
    )
    .await;
    assert_eq!(
        next_t(&mut ws, "result").await["error"]["code"],
        "not_allowed"
    );
    put(
        &mut ws,
        json!({"t":"call","id":3,"command":"events.wait","args":{}}),
    )
    .await;
    assert_eq!(
        next_t(&mut ws, "result").await["error"]["code"],
        "not_allowed"
    );
    put(
        &mut ws,
        json!({"t":"call","id":4,"command":"thread.list","args":{"bogus":1}}),
    )
    .await;
    assert_eq!(
        next_t(&mut ws, "result").await["error"]["code"],
        "invalid_call"
    );
    put(&mut ws, json!({"t":"nonsense"})).await;
    assert_eq!(
        next_t(&mut ws, "error").await["error"]["code"],
        "invalid_frame"
    );

    put(&mut ws, json!({"t":"call","id":5,"command":"message.send","args":{"thread_id":"t1","text":"hi"},"operation_id":"op-1"})).await;
    next_t(&mut ws, "result").await;
    let calls = owner.other_calls.lock().unwrap().clone();
    let send = calls
        .iter()
        .find_map(|c| match c {
            shellboy::protocol::Command::MessageSend(s) => Some(s.clone()),
            _ => None,
        })
        .expect("message.send reached the owner");
    assert!(send.human);
    assert_eq!(send.sender_label.as_deref(), Some("web"));
    assert!(
        !calls
            .iter()
            .any(|c| matches!(c, shellboy::protocol::Command::OwnerShutdown(_)))
    );
    cancel.cancel();
}

#[tokio::test]
async fn per_session_bound_replies_busy_and_cancel_frees_a_call() {
    use shellboy_studio::ws_limits::{SESSION_IN_FLIGHT, SESSION_QUEUE};
    let (owner, _tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner.clone(), false).await;
    let cookie = login(addr, &state).await;
    let mut ws = connect(addr, Some(&cookie), Some(&format!("http://{addr}")))
        .await
        .unwrap();
    next_t(&mut ws, "hello").await;
    let limit = (SESSION_IN_FLIGHT + SESSION_QUEUE) as u64;
    // `status` hangs in the mock, so every call stays outstanding.
    for id in 1..=limit {
        put(
            &mut ws,
            json!({"t":"call","id":id,"command":"status","args":{}}),
        )
        .await;
    }
    put(
        &mut ws,
        json!({"t":"call","id":limit + 1,"command":"status","args":{}}),
    )
    .await;
    let busy = next_t(&mut ws, "result").await;
    assert_eq!(busy["id"], limit + 1);
    assert_eq!(busy["error"]["code"], "busy");
    until("in-flight calls reach the owner", || {
        owner.other_calls.lock().unwrap().len() == SESSION_IN_FLIGHT
    })
    .await;
    // Only the per-session bound lets calls through to the owner at once.
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(owner.other_calls.lock().unwrap().len(), SESSION_IN_FLIGHT);
    // Cancelling an in-flight call frees its slot: a queued call then starts.
    put(&mut ws, json!({"t":"cancel","id":1})).await;
    until("a queued call starts", || {
        owner.other_calls.lock().unwrap().len() == SESSION_IN_FLIGHT + 1
    })
    .await;
    // Closing the tab aborts everything outstanding.
    drop(ws);
    cancel.cancel();
}

#[tokio::test]
async fn hints_reach_only_the_tabs_that_watch_and_resync_reaches_all() {
    let (owner, tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner.clone(), false).await;
    let cookie = login(addr, &state).await;
    let origin = format!("http://{addr}");
    let mut list_tab = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    let mut thread_tab = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    let mut idle_tab = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    for ws in [&mut list_tab, &mut thread_tab, &mut idle_tab] {
        next_t(ws, "hello").await;
    }
    put(
        &mut list_tab,
        json!({"t":"watch","thread_ids":[],"list":true}),
    )
    .await;
    put(
        &mut thread_tab,
        json!({"t":"watch","thread_ids":["t1"],"list":false}),
    )
    .await;
    // Watches are processed in order with the next call's result, so make sure they landed.
    for ws in [&mut list_tab, &mut thread_tab] {
        put(
            ws,
            json!({"t":"call","id":1,"command":"thread.list","args":{}}),
        )
        .await;
        next_t(ws, "result").await;
    }

    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    tx.send(events("inst1", "changed", "c2", &["t1", "t2"], false))
        .unwrap();
    let on_list = next_t(&mut list_tab, "changed").await;
    assert_eq!(on_list["list"], true);
    assert_eq!(
        on_list["thread_ids"],
        json!([]),
        "a list tab watches no Thread ids"
    );
    let on_thread = next_t(&mut thread_tab, "changed").await;
    assert_eq!(on_thread["thread_ids"], json!(["t1"]));
    assert_eq!(on_thread["list"], false);

    tx.send(events("inst1", "resync_required", "c3", &[], false))
        .unwrap();
    for ws in [&mut list_tab, &mut thread_tab, &mut idle_tab] {
        next_t(ws, "resync").await;
    }
    cancel.cancel();
}

#[tokio::test]
async fn live_text_frames_reach_only_the_tab_that_watches_and_are_one_frame_per_burst() {
    use shellboy_studio::live::{Delta, Entry};
    let (owner, _tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner.clone(), false).await;
    let cookie = login(addr, &state).await;
    let origin = format!("http://{addr}");
    let mut watching = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    let mut other = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    for ws in [&mut watching, &mut other] {
        next_t(ws, "hello").await;
    }
    put(
        &mut watching,
        json!({"t":"watch","thread_ids":["t1"],"list":false}),
    )
    .await;
    put(
        &mut watching,
        json!({"t":"call","id":1,"command":"thread.list","args":{}}),
    )
    .await;
    next_t(&mut watching, "result").await;
    let entry = |offset: u64, text: &str| Entry {
        thread_id: "t1".into(),
        attempt_id: "a1".into(),
        gap: false,
        deltas: vec![Delta {
            offset,
            reasoning: false,
            text: text.into(),
        }],
    };
    state.hub.live_apply(vec![entry(0, "Hel")], true);
    let first = next_t(&mut watching, "live").await;
    assert_eq!(first["thread_id"], "t1");
    assert_eq!(first["attempt_id"], "a1");
    assert_eq!(first["gap"], false);
    assert_eq!(
        first["deltas"],
        json!([{"offset":0,"reasoning":false,"text":"Hel"}])
    );
    state.hub.live_apply(vec![entry(0, "Hel")], false);
    state.hub.live_apply(
        vec![Entry {
            deltas: vec![Delta {
                offset: 3,
                reasoning: false,
                text: "lo".into(),
            }],
            ..entry(0, "")
        }],
        false,
    );
    let second = next_t(&mut watching, "live").await;
    assert_eq!(
        second["deltas"],
        json!([{"offset":3,"reasoning":false,"text":"lo"}]),
        "only what the tab has not seen"
    );
    state.hub.live_apply(vec![], false);
    let end = next_t(&mut watching, "live_end").await;
    assert_eq!(end["thread_id"], "t1");
    // The other tab never watched t1, so it heard nothing and the next frame it gets is its own.
    put(
        &mut other,
        json!({"t":"call","id":2,"command":"thread.list","args":{}}),
    )
    .await;
    assert_eq!(next(&mut other).await["t"], "result");
    cancel.cancel();
}

#[tokio::test]
async fn new_tabs_start_from_the_current_owner_state_and_hear_about_changes() {
    let (owner, tx) = mock(list_handler);
    let (addr, state, cancel) = start(owner.clone(), false).await;
    let cookie = login(addr, &state).await;
    let origin = format!("http://{addr}");
    let mut early = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    let hello = next_t(&mut early, "hello").await;
    assert_eq!(
        hello["owner"]["state"], "unreachable",
        "nothing answered yet"
    );
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    let event = next_t(&mut early, "owner").await;
    assert_eq!(event["event"], "connected");
    assert_eq!(event["owner"]["info"]["instance_id"], "inst1");
    // What this build was made to send: nothing in a normal build, pinned to the tag.
    let mut expected = Vec::new();
    if cfg!(feature = "next-shellboy") {
        expected.extend([
            "thread.reparent",
            "thread.settings",
            "config.edit",
            "live.text",
            "history.window",
        ]);
    }
    if cfg!(feature = "next-tags") {
        expected.push("thread.tags");
    }
    if cfg!(feature = "next-cwds") {
        expected.push("thread.cwds");
    }
    if cfg!(feature = "next-connection-setup") {
        expected.push("connection.setup");
    }
    let expected = json!(expected);
    assert_eq!(event["owner"]["info"]["capabilities"], expected);
    let mut late = connect(addr, Some(&cookie), Some(&origin)).await.unwrap();
    assert_eq!(
        next_t(&mut late, "hello").await["owner"]["state"],
        "connected"
    );
    tx.send(unreachable_owner()).unwrap();
    assert_eq!(next_t(&mut early, "owner").await["event"], "unreachable");
    cancel.cancel();
}

#[tokio::test]
async fn pairing_issue_requires_an_authenticated_session_and_allowed_host() {
    let (owner, _tx) = mock(list_handler);
    let app = router_only(owner, false);
    let post = |cookie: Option<String>, host: &str| {
        let mut req = Request::post("/pairing")
            .header(header::HOST, "127.0.0.1:8751")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(cookie) = cookie {
            req = req.header(header::COOKIE, cookie);
        }
        req.body(Body::from(json!({"host":host}).to_string()))
            .unwrap()
    };
    assert_eq!(
        app.clone()
            .oneshot(post(None, "example.ts.net"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let auth = Request::post("/auth")
        .header(header::HOST, "127.0.0.1:8751")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"token":"ab".repeat(32)}).to_string()))
        .unwrap();
    let response = app.clone().oneshot(auth).await.unwrap();
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        app.oneshot(post(Some(cookie), "example.ts.net"))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn pairing_link_exchanges_once_for_session_cookie() {
    use shellboy_studio::{
        auth::Auth,
        hub::Hub,
        server::{ServerConfig, Shared, router},
    };
    let (owner, _tx) = mock(list_handler);
    let state = Shared::new(
        owner,
        Hub::new(),
        Auth::new("ab".repeat(32)),
        ServerConfig {
            listen: "127.0.0.1:8751".parse().unwrap(),
            extra_hosts: vec!["mac.tail123.ts.net".into()],
            debug: false,
            data_dir: "/tmp/test".into(),
            config_dir: "/tmp/test-config".into(),
        },
    );
    let app = router(state);
    let send = |uri: &str, body: Value, cookie: Option<&str>| {
        let mut req = Request::post(uri)
            .header(header::HOST, "127.0.0.1:8751")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(cookie) = cookie {
            req = req.header(header::COOKIE, cookie);
        }
        req.body(Body::from(body.to_string())).unwrap()
    };
    let response = app
        .clone()
        .oneshot(send("/auth", json!({"token":"ab".repeat(32)}), None))
        .await
        .unwrap();
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .to_owned();
    let issued = app
        .clone()
        .oneshot(send(
            "/pairing",
            json!({"host":"mac.tail123.ts.net"}),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(issued.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(issued.into_body(), 8192)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    let url = value["url"].as_str().unwrap();
    assert!(url.starts_with("https://mac.tail123.ts.net/#pair="));
    assert!(!url.contains(&"ab".repeat(32)));
    let code = url.split_once("#pair=").unwrap().1;
    let exchanged = app
        .clone()
        .oneshot(send("/pairing/exchange", json!({"code":code}), None))
        .await
        .unwrap();
    assert_eq!(exchanged.status(), StatusCode::NO_CONTENT);
    assert!(exchanged.headers().contains_key(header::SET_COOKIE));
    let again = app
        .oneshot(send("/pairing/exchange", json!({"code":code}), None))
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn no_auth_http_keeps_host_origin_and_disables_pairing_credentials() {
    use shellboy_studio::{
        auth::Auth,
        hub::Hub,
        server::{ServerConfig, Shared, router},
    };
    for disabled in [false, true] {
        let (owner, _tx) = mock(list_handler);
        let dir = SyntheticDir::new();
        let app = router(Shared::new(
            owner,
            Hub::new(),
            if disabled {
                Auth::disabled()
            } else {
                Auth::new("ab".repeat(32))
            },
            ServerConfig {
                listen: "127.0.0.1:8751".parse().unwrap(),
                extra_hosts: vec!["studio.example.ts.net".into()],
                debug: true,
                data_dir: dir.path().into(),
                config_dir: dir.path().into(),
            },
        ));
        for host in ["127.0.0.1:8751", "studio.example.ts.net"] {
            for (path, method, body) in [
                ("/auth-mode", "GET", ""),
                ("/guide-preference", "GET", ""),
                ("/guide-preference", "POST", "{\"enabled\":false}"),
                ("/auth", "POST", "{\"token\":\"wrong\"}"),
                ("/pairing", "GET", ""),
                ("/pairing", "POST", "{\"host\":\"studio.example.ts.net\"}"),
                ("/pairing/exchange", "POST", "{\"code\":\"wrong\"}"),
            ] {
                let request = |host: &str, origin: &str| {
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header(header::HOST, host)
                        .header(header::ORIGIN, origin)
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap()
                };
                let response = app
                    .clone()
                    .oneshot(request(host, &format!("https://{host}")))
                    .await
                    .unwrap();
                let expected = if path == "/auth-mode" {
                    StatusCode::OK
                } else if disabled && path.starts_with("/pairing") {
                    StatusCode::CONFLICT
                } else if disabled && method == "GET" {
                    StatusCode::OK
                } else if disabled {
                    StatusCode::NO_CONTENT
                } else {
                    StatusCode::UNAUTHORIZED
                };
                assert_eq!(
                    response.status(),
                    expected,
                    "{disabled} {host} {method} {path}"
                );
                assert!(!response.headers().contains_key(header::SET_COOKIE));
                if path == "/auth-mode" {
                    assert_eq!(
                        response.headers().get(header::CACHE_CONTROL).unwrap(),
                        "no-store"
                    );
                    let bytes = axum::body::to_bytes(response.into_body(), 1024)
                        .await
                        .unwrap();
                    assert_eq!(
                        serde_json::from_slice::<Value>(&bytes).unwrap(),
                        json!({"authentication_required": !disabled})
                    );
                }

                assert_eq!(
                    app.clone()
                        .oneshot(request(host, "https://evil.example"))
                        .await
                        .unwrap()
                        .status(),
                    StatusCode::FORBIDDEN
                );
                assert_eq!(
                    app.clone()
                        .oneshot(request("evil.example", "https://evil.example"))
                        .await
                        .unwrap()
                        .status(),
                    StatusCode::FORBIDDEN
                );
            }
        }
    }
}

#[tokio::test]
async fn no_auth_ws_accepts_loopback_and_proxy_but_never_bad_host_or_origin() {
    use shellboy_studio::{
        auth::Auth,
        hub::Hub,
        server::{ServerConfig, Shared, serve},
    };
    for disabled in [false, true] {
        let (owner, _tx) = mock(list_handler);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let dir = SyntheticDir::new();
        let state = Shared::new(
            owner,
            Hub::new(),
            if disabled {
                Auth::disabled()
            } else {
                Auth::new("ab".repeat(32))
            },
            ServerConfig {
                listen: addr,
                extra_hosts: vec!["studio.example.ts.net".into()],
                debug: false,
                data_dir: dir.path().into(),
                config_dir: dir.path().into(),
            },
        );
        let cancel = tokio_util::sync::CancellationToken::new();
        let task = tokio::spawn(serve(listener, state.clone(), fast_poll(), cancel.clone()));
        for (host, origin, expected) in [
            (
                addr.to_string(),
                format!("http://{addr}"),
                if disabled { 101 } else { 401 },
            ),
            (
                "studio.example.ts.net".into(),
                "https://studio.example.ts.net".into(),
                if disabled { 101 } else { 401 },
            ),
            ("evil.example".into(), "https://evil.example".into(), 403),
            (
                "studio.example.ts.net".into(),
                "https://evil.example".into(),
                403,
            ),
        ] {
            let mut request = format!("ws://{addr}/ws").into_client_request().unwrap();
            request.headers_mut().insert("host", host.parse().unwrap());
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
            match tokio_tungstenite::connect_async(request).await {
                Ok((mut socket, response)) => {
                    assert_eq!(response.status().as_u16(), expected);
                    socket.close(None).await.unwrap();
                }
                Err(e) => assert_eq!(status_of(e), expected),
            }
        }
        if !disabled {
            let cookie = login(addr, &state).await;
            let mut socket = connect(addr, Some(&cookie), Some(&format!("http://{addr}")))
                .await
                .unwrap();
            socket.close(None).await.unwrap();
        }
        cancel.cancel();
        task.await.unwrap().unwrap();
    }
}

struct SyntheticDir(std::path::PathBuf);
impl SyntheticDir {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("studio-no-auth-{}", uuid::Uuid::new_v4())))
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}
impl Drop for SyntheticDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
