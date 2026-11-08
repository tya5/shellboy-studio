//! The embedded production frontend. `index.html` is revalidated; everything under `assets/`
//! is immutable when hash-named; stable brand and manifest assets are revalidated.
use axum::{
    body::Body,
    extract::Path,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// Nothing leaves the bridge's own origin: no CDN, no font host, and a model's Markdown can't
/// load remote images. Preact sets element styles through the CSSOM, which `style-src` allows.
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'self'";

fn find(table: &'static [(&'static str, &'static [u8])], path: &str) -> Option<&'static [u8]> {
    table
        .iter()
        .find(|(p, _)| *p == path)
        .map(|(_, bytes)| *bytes)
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("webmanifest") => "application/manifest+json",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

pub async fn index() -> Response {
    match find(EMBEDDED, "index.html") {
        Some(bytes) => (
            [
                (header::CONTENT_TYPE, content_type("index.html")),
                (header::CACHE_CONTROL, "no-cache"),
                (header::CONTENT_SECURITY_POLICY, CSP),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                (header::REFERRER_POLICY, "no-referrer"),
            ],
            Body::from(bytes),
        )
            .into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "shellboy-studio: this binary has no frontend. Run `npm ci && npm run build` in web/, then build the bridge again.\n",
        )
            .into_response(),
    }
}

pub async fn asset(Path(path): Path<String>) -> Response {
    let full = format!("assets/{path}");
    match find(EMBEDDED, &full) {
        Some(bytes) => (
            [
                (header::CONTENT_TYPE, content_type(&full)),
                // Brand/manifest names are stable across releases, unlike hashed chunks.
                (
                    header::CACHE_CONTROL,
                    if path.starts_with("brand/") || path == "manifest.webmanifest" {
                        "no-cache"
                    } else {
                        "public, max-age=31536000, immutable"
                    },
                ),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            Body::from(bytes),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_is_exact_and_types_are_known() {
        let table: &'static [(&'static str, &'static [u8])] = &[("assets/a.js", b"x")];
        assert_eq!(find(table, "assets/a.js"), Some(&b"x"[..]));
        assert_eq!(find(table, "assets/../a.js"), None);
        assert_eq!(find(table, "a.js"), None);
        assert!(content_type("assets/a.js").starts_with("text/javascript"));
        assert!(content_type("index.html").starts_with("text/html"));
        assert_eq!(content_type("x.bin"), "application/octet-stream");
        assert_eq!(content_type("brand/icon.png"), "image/png");
        assert_eq!(
            content_type("manifest.webmanifest"),
            "application/manifest+json"
        );
    }

    #[test]
    fn nothing_external_is_allowed() {
        assert!(!CSP.contains("http"));
        // Apps are framed from this same port.
        assert!(CSP.contains("frame-src 'self'"));
        assert!(CSP.contains("default-src 'none'"));
        assert!(CSP.contains("manifest-src 'self'"));
    }

    #[tokio::test]
    #[ignore = "requires npm run build; exercises only embedded asset HTTP, never an owner"]
    async fn embedded_bright_teal_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let app = axum::Router::new()
            .route("/", axum::routing::get(index))
            .route("/assets/{*path}", axum::routing::get(asset));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let checks = [
            ("/", "text/html; charset=utf-8", "no-cache"),
            (
                "/assets/brand/studio-teal-master.svg",
                "image/svg+xml",
                "no-cache",
            ),
            ("/assets/brand/studio-teal-16.png", "image/png", "no-cache"),
            ("/assets/brand/studio-teal-32.png", "image/png", "no-cache"),
            ("/assets/brand/studio-teal-180.png", "image/png", "no-cache"),
            ("/assets/brand/studio-teal-192.png", "image/png", "no-cache"),
            ("/assets/brand/studio-teal-512.png", "image/png", "no-cache"),
            (
                "/assets/manifest.webmanifest",
                "application/manifest+json",
                "no-cache",
            ),
        ];
        let checks = checks.into_iter().chain([
            (
                "/assets/brand/studio-favicon.svg",
                "image/svg+xml",
                "no-cache",
            ),
            ("/assets/brand/studio-teal.ico", "image/x-icon", "no-cache"),
        ]);
        for (path, mime, cache) in checks {
            let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
            stream
                .write_all(
                    format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n")
                        .as_bytes(),
                )
                .await
                .unwrap();
            let mut bytes = Vec::new();
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                stream.read_to_end(&mut bytes),
            )
            .await
            .unwrap()
            .unwrap();
            let split = bytes.windows(4).position(|x| x == b"\r\n\r\n").unwrap();
            let headers = std::str::from_utf8(&bytes[..split])
                .unwrap()
                .to_ascii_lowercase();
            assert!(headers.starts_with("http/1.1 200"), "{path}: {headers}");
            assert!(headers.contains(&format!("content-type: {mime}")));
            assert!(headers.contains(&format!("cache-control: {cache}")));
            assert!(headers.contains("x-content-type-options: nosniff"));
            assert_eq!(
                &bytes[split + 4..],
                find(
                    EMBEDDED,
                    if path == "/" {
                        "index.html"
                    } else {
                        &path[1..]
                    }
                )
                .unwrap()
            );
            if path == "/" {
                assert!(headers.contains("manifest-src 'self'"));
            }
        }
        server.abort();
        let _ = server.await;
    }
}
