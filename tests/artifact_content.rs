mod common;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use serde_json::{Value, json};
use shellboy::protocol::Command;
use shellboy_studio::server::router;
use tower::ServiceExt;

#[tokio::test]
async fn preview_requires_cookie_and_exact_owner_version_within_loaded_limit() {
    let fixture = std::env::temp_dir().join(format!("studio-artifact-{}.md", uuid::Uuid::new_v4()));
    std::fs::write(&fixture, "# fixture").unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let over = fixture.with_extension("over.md");
    std::fs::write(&over, "# fixture!").unwrap();
    let _cleanup = (Cleanup(fixture.clone()), Cleanup(over.clone()));
    let missing_limit = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let config_missing = missing_limit.clone();
    let (owner, _unused) = common::mock(move |cmd| match cmd {
        Command::ArtifactGet(args) => Some(json!({
            "thread_id":"thread", "artifact_id":"artifact", "created_at":"now", "updated_at":"now",
            "version":{"version":args.version, "uri":match args.version { Some(4) => json!(over), Some(6) => json!("https://example.invalid/report.md"), _ => json!(fixture) }, "title":"Report", "mime":if args.version == Some(3) { "text/html" } else { "text/markdown" }, "created_at":"now"}
        })),
        Command::ConfigGet(_) if config_missing.load(std::sync::atomic::Ordering::Relaxed) => {
            Some(json!({"loaded":{"values":{}}}))
        }
        Command::ConfigGet(_) => {
            Some(json!({"loaded":{"values":{"limits":{"attachment_file_bytes":9}}}}))
        }
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
    for (version, missing, reason) in [
        (4, false, "10 bytes exceeds 9"),
        (5, true, "missing owner limit"),
        (6, false, "HTTPS URI"),
    ] {
        missing_limit.store(missing, std::sync::atomic::Ordering::Relaxed);
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
    assert_eq!(
        owner
            .other_calls
            .lock()
            .unwrap()
            .iter()
            .filter(|cmd| matches!(cmd, Command::ConfigGet(_)))
            .count(),
        3
    );
}
