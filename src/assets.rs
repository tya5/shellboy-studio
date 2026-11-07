//! The embedded production frontend. `index.html` is revalidated; everything under `assets/`
//! has a content hash in its name and is immutable.
use axum::{
    body::Body,
    extract::Path,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

/// Nothing leaves the bridge's own origin: no CDN, no font host, and a model's Markdown can't
/// load remote images. Preact sets element styles through the CSSOM, which `style-src` allows.
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src http: https:";

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
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("json" | "webmanifest") => "application/json",
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
            "shellboy-web: this binary has no frontend. Run `npm ci && npm run build` in web/, then build the bridge again.\n",
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
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
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
    }

    #[test]
    fn nothing_external_is_allowed() {
        // Nothing may load from elsewhere; only apps may be framed, on their own origins.
        assert!(!CSP.replace("frame-src http: https:", "").contains("http"));
        assert!(CSP.contains("default-src 'none'"));
    }
}
