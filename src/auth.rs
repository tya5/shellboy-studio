//! Token and session cookie.
//!
//! The token is 256 random bits in a file (mode 0600 on Unix) in the bridge's own config
//! directory. `POST /auth` exchanges it for a random session id kept in memory (bounded,
//! oldest evicted; a bridge restart asks for the token again). The bridge never logs the
//! token or cookies.
use std::{
    collections::VecDeque,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

/// Cookies ignore ports, so two bridges on one host need different names or each login overwrites
/// the other's. A bridge's port is unique on its host; behind a proxy it still tells them apart.
pub fn cookie_name(port: u16) -> String {
    format!("sbw_session_{port}")
}
/// Bound on live browser sessions kept in memory.
pub const MAX_SESSION_COOKIES: usize = 256;

pub const PAIRING_LIMIT: usize = 16;
pub const PAIRING_TTL: Duration = Duration::from_secs(120);

pub struct Auth {
    token: String,
    sessions: Mutex<VecDeque<String>>,
    pairings: Mutex<VecDeque<(String, Instant)>>,
}

pub fn random_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("no random source: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Constant-time comparison for equal-length secrets.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Auth {
    pub fn new(token: String) -> Self {
        Self {
            token,
            sessions: Mutex::new(VecDeque::new()),
            pairings: Mutex::new(VecDeque::new()),
        }
    }

    /// Read the token file, or create it with a fresh token. Bridges may share a config directory,
    /// and so the token: each keeps its own sessions. Two creating it at once end up with one token,
    /// because the file appears complete or not at all and the second adopts what's there.
    pub fn load_or_create(config_dir: &Path) -> Result<Self, String> {
        let path = config_dir.join("token");
        if let Some(found) = read_token(&path)? {
            return Ok(found);
        }
        std::fs::create_dir_all(config_dir)
            .map_err(|e| format!("cannot create {}: {e}", config_dir.display()))?;
        let token = random_hex()?;
        let temporary = config_dir.join(format!(".token.{}.tmp", random_hex()?));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let written = options
            .open(&temporary)
            .and_then(|mut file| file.write_all(token.as_bytes()))
            .and_then(|()| std::fs::hard_link(&temporary, &path));
        let _ = std::fs::remove_file(&temporary);
        match written {
            Ok(()) => Ok(Self::new(token)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => read_token(&path)?
                .ok_or_else(|| format!("{} disappeared while it was created", path.display())),
            Err(e) => Err(format!("cannot create {}: {e}", path.display())),
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn token_matches(&self, candidate: &str) -> bool {
        same(&self.token, candidate)
    }

    /// New session id after a correct token.
    pub fn issue_session(&self) -> Result<String, String> {
        let id = random_hex()?;
        let mut sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        if sessions.len() >= MAX_SESSION_COOKIES {
            sessions.pop_front();
        }
        sessions.push_back(id.clone());
        Ok(id)
    }

    pub fn issue_pairing(&self) -> Result<String, &'static str> {
        let mut codes = self.pairings.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        codes.retain(|(_, expires)| *expires > now);
        if codes.len() >= PAIRING_LIMIT {
            return Err("too many active codes");
        }
        let code = random_hex().map_err(|_| "no random source")?;
        codes.push_back((code.clone(), now + PAIRING_TTL));
        Ok(code)
    }

    pub fn consume_pairing(&self, candidate: &str) -> bool {
        let mut codes = self.pairings.lock().unwrap_or_else(|p| p.into_inner());
        let now = Instant::now();
        codes.retain(|(_, expires)| *expires > now);
        if let Some(index) = codes.iter().position(|(code, _)| same(code, candidate)) {
            codes.remove(index);
            true
        } else {
            false
        }
    }

    /// Does a `Cookie` header carry a live session?
    pub fn cookie_valid(&self, name: &str, cookie_header: Option<&str>) -> bool {
        let Some(header) = cookie_header else {
            return false;
        };
        let sessions = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        header
            .split(';')
            .filter_map(|part| part.trim().split_once('='))
            .filter(|(cookie, _)| *cookie == name)
            .any(|(_, value)| sessions.iter().any(|s| same(s, value)))
    }
}

fn read_token(path: &Path) -> Result<Option<Auth>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().len() == 64 => Ok(Some(Auth::new(text.trim().to_owned()))),
        Ok(_) => Err(format!("{} is not a bridge token file", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

pub fn default_config_dir() -> Result<PathBuf, String> {
    use shellboy::config::{PathEnvironment, Platform};
    let env = PathEnvironment::current();
    let dir = match env.platform {
        Platform::Linux => env
            .xdg_config_home
            .or_else(|| env.home.map(|h| h.join(".config"))),
        Platform::Macos => env.home.map(|h| h.join("Library/Application Support")),
        Platform::Windows => env.appdata,
    };
    dir.map(|d| d.join("shellboy-studio"))
        .ok_or_else(|| "cannot determine the config directory; pass --config-dir".to_owned())
}

/// Only DNS names without a scheme, port or path are safe URL authorities.
pub fn pairing_host(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// Host header (with optional port) against loopback names, the listen address and
/// configured extra names. Blocks DNS rebinding.
pub fn host_allowed(host: &str, listen: &std::net::SocketAddr, extra: &[String]) -> bool {
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split_once(']').map(|(n, _)| n).unwrap_or(rest)
    } else {
        host.rsplit_once(':').map(|(n, _)| n).unwrap_or(host)
    }
    .to_ascii_lowercase();
    let listen_ip = listen.ip().to_string();
    matches!(name.as_str(), "localhost" | "127.0.0.1" | "::1")
        || (!listen.ip().is_unspecified() && name == listen_ip)
        || extra.iter().any(|e| e.eq_ignore_ascii_case(&name))
}

/// `Origin` must name the same authority as `Host`. Absent is allowed: only browsers send
/// it, and they always do on cross-site requests and WebSocket upgrades.
pub fn origin_matches(origin: Option<&str>, host: &str) -> bool {
    match origin {
        None => true,
        Some(o) => o
            .split_once("://")
            .is_some_and(|(_, authority)| authority.eq_ignore_ascii_case(host)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_codes_expire_are_single_use_and_bounded() {
        let auth = Auth::new("t".repeat(64));
        let code = auth.issue_pairing().unwrap();
        assert!(auth.consume_pairing(&code));
        assert!(!auth.consume_pairing(&code));
        let expired = auth.issue_pairing().unwrap();
        auth.pairings.lock().unwrap().front_mut().unwrap().1 =
            Instant::now() - Duration::from_secs(1);
        assert!(!auth.consume_pairing(&expired));
        for _ in 0..PAIRING_LIMIT {
            auth.issue_pairing().unwrap();
        }
        assert!(auth.issue_pairing().is_err());
    }

    #[test]
    fn pairing_hosts_require_plain_dns_names() {
        assert!(pairing_host("mac.tail123.ts.net"));
        for host in [
            "evil.test/path",
            "https://evil.test",
            "evil.test:443",
            "bad..test",
            "-bad.test",
            "evil.test@ok.test",
            "localhost",
        ] {
            assert!(!pairing_host(host));
        }
    }

    #[test]
    fn host_and_origin_rules() {
        let listen: std::net::SocketAddr = "127.0.0.1:8751".parse().unwrap();
        let extra = vec!["box.tail1234.ts.net".to_owned()];
        assert!(host_allowed("127.0.0.1:8751", &listen, &extra));
        assert!(host_allowed("localhost:8751", &listen, &extra));
        assert!(host_allowed("[::1]:8751", &listen, &extra));
        assert!(host_allowed("BOX.tail1234.ts.net", &listen, &extra));
        assert!(!host_allowed("evil.example:8751", &listen, &extra));
        assert!(!host_allowed("127.0.0.1.evil.example", &listen, &extra));
        assert!(origin_matches(None, "127.0.0.1:8751"));
        assert!(origin_matches(
            Some("http://127.0.0.1:8751"),
            "127.0.0.1:8751"
        ));
        assert!(!origin_matches(
            Some("http://evil.example"),
            "127.0.0.1:8751"
        ));
        assert!(!origin_matches(Some("null"), "127.0.0.1:8751"));
    }

    #[test]
    fn sessions_are_bounded_and_checked() {
        let auth = Auth::new("t".repeat(64));
        assert!(auth.token_matches(&"t".repeat(64)));
        assert!(!auth.token_matches("t"));
        let first = auth.issue_session().unwrap();
        let name = cookie_name(18752);
        let header = format!("a=b; {name}={first}");
        assert!(auth.cookie_valid(&name, Some(&header)));
        assert!(!auth.cookie_valid(&name, Some(&format!("{name}=nope"))));
        assert!(!auth.cookie_valid(&name, None));
        assert!(
            !auth.cookie_valid(&cookie_name(18753), Some(&header)),
            "another bridge's cookie"
        );
        for _ in 0..MAX_SESSION_COOKIES {
            auth.issue_session().unwrap();
        }
        assert!(
            !auth.cookie_valid(&name, Some(&header)),
            "oldest session is evicted"
        );
    }

    #[test]
    fn bridges_sharing_a_config_dir_share_one_token() {
        let dir = std::env::temp_dir().join(format!("sbw-token-{}", random_hex().unwrap()));
        let tokens: Vec<String> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..8)
                .map(|_| scope.spawn(|| Auth::load_or_create(&dir).unwrap().token().to_owned()))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert!(tokens.iter().all(|t| *t == tokens[0]), "one token");
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["token"], "no temporary file stays");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
