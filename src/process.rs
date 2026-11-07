//! The bridge's own memory, as the OS reports it, on request only. Shellboy's helper for this is private
//! to its crate, so this is the smallest thing that works: `/proc` on Linux, `ps` elsewhere on Unix.
use serde_json::{Value, json};

#[cfg(target_os = "linux")]
async fn resident_bytes() -> Result<u64, String> {
    let text = tokio::fs::read_to_string("/proc/self/status")
        .await
        .map_err(|e| e.to_string())?;
    text.lines()
        .find_map(|l| l.strip_prefix("VmRSS:"))
        .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok())
        .map(|kib| kib * 1024)
        .ok_or_else(|| "VmRSS isn't in /proc/self/status".to_owned())
}

#[cfg(all(unix, not(target_os = "linux")))]
async fn resident_bytes() -> Result<u64, String> {
    let out = tokio::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("ps: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.trim()
        .parse::<u64>()
        .map(|kib| kib * 1024)
        .map_err(|_| "ps gave no number".to_owned())
}

#[cfg(not(unix))]
async fn resident_bytes() -> Result<u64, String> {
    Err("Not read on this platform".to_owned())
}

pub async fn memory() -> Value {
    match resident_bytes().await {
        Ok(bytes) => json!({"rss_bytes": bytes, "unavailable_reason": null}),
        Err(reason) => json!({"rss_bytes": null, "unavailable_reason": reason}),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[tokio::test]
    async fn reports_a_real_number_or_says_why() {
        let out = super::memory().await;
        assert!(
            out["rss_bytes"].as_u64().is_some_and(|b| b > 0)
                || out["unavailable_reason"].is_string(),
            "{out}"
        );
    }
}
