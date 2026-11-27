//! `shellboy.call(serviceName, path, body)`: resolve a named service of the app's owning Thread
//! through Core, then forward one HTTP request with its current token. No retry or polling: failures
//! are returned to the page.
use super::host::{ApiFail, MAX_DATA, WAIT};
use serde_json::{Value, json};
use shellboy::protocol::ServiceEndpoint;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn visible(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

pub(super) fn endpoint_error(error: Value) -> ApiFail {
    let reason = error["details"]["reason"].as_str().unwrap_or_default();
    match reason {
        "service_not_found" => ("no_backend", "The named service does not exist".to_owned()),
        "service_not_running" | "service_endpoint_unavailable" => (
            "backend_down",
            "The named service is not running or has not published its endpoint".to_owned(),
        ),
        _ => (
            "backend_failed",
            error["message"]
                .as_str()
                .unwrap_or("Core could not resolve the named service")
                .to_owned(),
        ),
    }
}

/// Forward one request to the exact endpoint returned by Core for the selected service.
pub(super) async fn call(endpoint: ServiceEndpoint, args: &Value) -> Result<Value, ApiFail> {
    let path = args.get("path").and_then(Value::as_str).unwrap_or_default();
    if !path.starts_with('/') || path.starts_with("//") || path.contains('#') || !visible(path) {
        return Err((
            "invalid_path",
            "path must start with / and hold only printable characters, without #".to_owned(),
        ));
    }
    let body = match args.get("body") {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => serde_json::to_vec(value).map_err(|e| ("invalid_args", e.to_string()))?,
    };
    if body.len() > MAX_DATA {
        return Err(("too_large", "The request body is over 8 MiB".to_owned()));
    }
    if endpoint.port == 0 || !visible(&endpoint.token) {
        return Err((
            "backend_failed",
            "Core returned an invalid service endpoint".to_owned(),
        ));
    }
    let mut request = format!(
        "POST {path} HTTP/1.0\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        endpoint.port,
        endpoint.token,
        body.len()
    );
    if !body.is_empty() {
        request.push_str("Content-Type: application/json\r\n");
    }
    request.push_str("\r\n");
    let exchange = async {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", endpoint.port))
            .await
            .map_err(|e| ("backend_down", format!("The backend does not answer: {e}")))?;
        let io = |e: std::io::Error| ("backend_failed", format!("The backend failed: {e}"));
        stream.write_all(request.as_bytes()).await.map_err(io)?;
        stream.write_all(&body).await.map_err(io)?;
        let mut raw = Vec::new();
        // HTTP/1.0 with close: the body ends at EOF. Headers count toward the same bound.
        (&mut stream)
            .take(MAX_DATA as u64 + 1)
            .read_to_end(&mut raw)
            .await
            .map_err(io)?;
        if raw.len() > MAX_DATA {
            return Err(("too_large", "The response is over 8 MiB".to_owned()));
        }
        Ok(raw)
    };
    let raw = match tokio::time::timeout(WAIT, exchange).await {
        Ok(done) => done?,
        Err(_) => {
            return Err((
                "backend_timeout",
                "The backend did not answer in time".to_owned(),
            ));
        }
    };
    let bad = || {
        (
            "backend_failed",
            "The backend did not answer with HTTP".to_owned(),
        )
    };
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(bad)?;
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let status: u16 = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or_else(bad)?;
    if status == 401 || status == 403 {
        return Err((
            "backend_refused",
            format!("The backend refused the token ({status}); its service may have restarted"),
        ));
    }
    let payload = &raw[split + 4..];
    let json = head.lines().skip(1).any(|l| {
        l.to_ascii_lowercase().starts_with("content-type:")
            && l.to_ascii_lowercase().contains("json")
    });
    let body = match json.then(|| serde_json::from_slice::<Value>(payload)) {
        Some(Ok(value)) => value,
        _ => Value::String(String::from_utf8_lossy(payload).into_owned()),
    };
    Ok(json!({"status": status, "body": body}))
}
