mod common;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use shellboy::protocol::{ApiError, Command, ErrorCode};
use shellboy_studio::server::router;
use tower::ServiceExt;

#[tokio::test]
async fn preview_requires_cookie_and_exact_owner_version_within_loaded_limit() {
    // The owner is the only reader: it serves version 2 and refuses the others as Core does.
    let (owner, _unused) = common::mock_replies(move |cmd| match cmd {
        Command::ArtifactGet(args) => common::ok_reply(json!({
            "thread_id":"thread", "artifact_id":"artifact", "created_at":"now", "updated_at":"now",
            "version":{"version":args.version, "uri":"/anywhere/report.md", "title":"Report", "mime":if args.version == Some(3) { "text/html" } else { "text/markdown" }, "created_at":"now"}
        })),
        Command::ArtifactRead(args) => Some(match args.version {
            2 => common::ok_reply(
                json!({"artifact_id":"artifact","version":2,"raw_bytes":9,"base64":"IyBmaXh0dXJl"}),
            )?,
            4 => Err(ApiError::new(ErrorCode::InputLimit, "too large")),
            _ => Err(ApiError::new(ErrorCode::InvalidArgument, "not readable")),
        }),
        _ => None,
    });
    let app = router(common::app_state(
        owner.clone(),
        false,
        "127.0.0.1:8751".parse().unwrap(),
    ));
    let post = |route: &str, origin: &str, body: Value, cookie: Option<&str>| {
        let mut req = Request::post(route)
            .header(header::HOST, "127.0.0.1:8751")
            .header(header::ORIGIN, origin)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(cookie) = cookie {
            req = req.header(header::COOKIE, cookie);
        }
        req.body(Body::from(body.to_string())).unwrap()
    };
    let origin = "http://127.0.0.1:8751";
    let target =
        json!({"artifact_id":"artifact","thread_id":"thread","version":2,"action":"preview"});
    let response = app
        .clone()
        .oneshot(post("/artifact-content", origin, target.clone(), None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(owner.other_calls.lock().unwrap().is_empty());
    let response = app
        .clone()
        .oneshot(post(
            "/auth",
            origin,
            json!({"token":"ab".repeat(32)}),
            None,
        ))
        .await
        .unwrap();
    let cookie = response.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    for (body, source, status) in [
        (
            target.clone(),
            "https://other.invalid",
            StatusCode::UNAUTHORIZED,
        ),
        (
            json!({"artifact_id":"artifact","thread_id":"other","version":2,"action":"preview"}),
            origin,
            StatusCode::NOT_FOUND,
        ),
        (
            json!({"artifact_id":"artifact","thread_id":"thread","version":3,"action":"preview"}),
            origin,
            StatusCode::NO_CONTENT,
        ),
        (
            json!({"artifact_id":"artifact","thread_id":"thread","version":2,"action":"open"}),
            origin,
            StatusCode::NOT_FOUND,
        ),
        (
            json!({"artifact_id":"artifact","thread_id":"thread","version":2,"action":"preview","uri":"ignored"}),
            origin,
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(post("/artifact-content", source, body, Some(&cookie)))
                .await
                .unwrap()
                .status(),
            status
        );
    }
    for (version, reason) in [(4, "over the owner's limit"), (5, "refused URI")] {
        let mut body = target.clone();
        body["version"] = json!(version);
        let response = app
            .clone()
            .oneshot(post("/artifact-content", origin, body, Some(&cookie)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT, "{reason}");
    }
    let response = app
        .oneshot(post("/artifact-content", origin, target, Some(&cookie)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    assert_eq!(
        to_bytes(response.into_body(), 9).await.unwrap(),
        "# fixture"
    );
    let reads: Vec<_> = owner
        .other_calls
        .lock()
        .unwrap()
        .iter()
        .filter_map(|cmd| match cmd {
            Command::ArtifactRead(args) => Some((
                args.thread_id.clone(),
                args.artifact_id.clone(),
                args.version,
                args.path.clone(),
            )),
            _ => None,
        })
        .collect();
    assert!(
        reads
            .iter()
            .all(|read| read.0 == "thread" && read.1 == "artifact" && read.3.is_none()),
        "a preview reads the exact artifact version, as one file: {reads:?}"
    );
    assert!(reads.iter().any(|read| read.2 == 2));
}
