//! `shellboy.call(path, body)`: one plain HTTP request to the app's own backend. The backend is a Core
//! service the app's Thread started in the app's folder; it listens on 127.0.0.1 and writes
//! `{port, token}` to `.app.endpoint` there at each start. Studio reads that file for every call (no
//! cached port, so a restarted backend is found), sends the token, and forwards nothing outside the
//! app's own folder. No retry and no polling: a failure is the answer.
use super::host::{ApiFail, MAX_DATA, WAIT};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) const ENDPOINT: &str = ".app.endpoint";
/// The file holds a port and a token; anything larger is not an endpoint file.
const MAX_ENDPOINT: u64 = 4096;

struct Endpoint {
    port: u16,
    token: String,
}

fn visible(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

async fn read_endpoint(file: Option<std::path::PathBuf>) -> Result<Endpoint, ApiFail> {
    let unreadable = |why: String| ("backend_endpoint_unreadable", why);
    let Some(file) = file else {
        return Err((
            "no_backend",
            format!("This app has no {ENDPOINT}: its service is not running"),
        ));
    };
    let mut bytes = Vec::new();
    let opened = tokio::fs::File::open(&file)
        .await
        .map_err(|e| unreadable(format!("{ENDPOINT} can't be opened: {e}")))?;
    opened
        .take(MAX_ENDPOINT + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| unreadable(format!("{ENDPOINT} can't be read: {e}")))?;
    if bytes.len() as u64 > MAX_ENDPOINT {
        return Err(unreadable(format!("{ENDPOINT} is too large")));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| unreadable(format!("{ENDPOINT} is not JSON {{port, token}}")))?;
    let port = value["port"]
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0);
    let token = value["token"].as_str().filter(|t| visible(t));
    match (port, token) {
        (Some(port), Some(token)) => Ok(Endpoint {
            port,
            token: token.to_owned(),
        }),
        _ => Err(unreadable(format!(
            "{ENDPOINT} needs a port and a printable token"
        ))),
    }
}

/// `file` is the endpoint file inside the app's folder, or `None` when there is none.
pub(super) async fn call(file: Option<std::path::PathBuf>, args: &Value) -> Result<Value, ApiFail> {
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
    let endpoint = read_endpoint(file).await?;
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
