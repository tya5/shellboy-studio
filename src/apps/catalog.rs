//! Finding apps: one read of the folder per request, so a new folder needs no restart. Files only;
//! nothing is cached. A folder that can't be used is still listed, with the reason.
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

pub const MAX_APPS: usize = 64;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_NAME: usize = 40;

#[derive(Debug, Default, Deserialize)]
struct Manifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    thread: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppEntry {
    pub name: String,
    pub title: String,
    pub entry: String,
    pub thread: Option<String>,
    /// Why this app can't open. The folder stays listed so its author can see it.
    pub problem: Option<String>,
}

/// The folder name is the app's ID, which also names its cookie and sender label.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        && !name.starts_with('-')
}

/// A path inside an app: relative, with no way out of it. Symlinks are checked when opened.
pub fn safe_relative(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains('\0') || path.contains('\\') {
        return None;
    }
    let p = Path::new(path);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (out.components().next().is_some()).then_some(out)
}

pub async fn read_entry(apps_dir: &Path, name: &str) -> Option<AppEntry> {
    if !valid_name(name) {
        return None;
    }
    let dir = apps_dir.join(name);
    if !tokio::fs::metadata(&dir).await.ok()?.is_dir() {
        return None;
    }
    let mut entry = AppEntry {
        name: name.to_owned(),
        title: name.to_owned(),
        entry: "index.html".into(),
        thread: None,
        problem: None,
    };
    let manifest = dir.join("app.json");
    match tokio::fs::metadata(&manifest).await {
        Err(_) => {
            entry.problem = Some("app.json is missing".into());
            return Some(entry);
        }
        Ok(m) if m.len() > MAX_MANIFEST_BYTES => {
            entry.problem = Some("app.json is too large".into());
            return Some(entry);
        }
        Ok(_) => {}
    }
    let parsed = match tokio::fs::read(&manifest).await {
        Ok(bytes) => serde_json::from_slice::<Manifest>(&bytes)
            .map_err(|e| format!("app.json can't be read: {e}")),
        Err(e) => Err(format!("app.json can't be read: {e}")),
    };
    let manifest = match parsed {
        Ok(m) => m,
        Err(problem) => {
            entry.problem = Some(problem);
            return Some(entry);
        }
    };
    if let Some(title) = manifest.name.filter(|t| !t.trim().is_empty()) {
        entry.title = title;
    }
    entry.thread = manifest.thread.filter(|t| !t.is_empty());
    if let Some(file) = manifest.entry {
        entry.entry = file;
    }
    match safe_relative(&entry.entry) {
        None => entry.problem = Some(format!("entry {} isn't a path inside the app", entry.entry)),
        Some(rel) => {
            if !tokio::fs::metadata(dir.join(rel))
                .await
                .is_ok_and(|m| m.is_file())
            {
                entry.problem = Some(format!("entry {} doesn't exist", entry.entry));
            }
        }
    }
    Some(entry)
}

pub async fn list(apps_dir: &Path) -> Result<Vec<AppEntry>, String> {
    let mut names = Vec::new();
    let mut dir = match tokio::fs::read_dir(apps_dir).await {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    while let Ok(Some(item)) = dir.next_entry().await {
        if let Some(name) = item.file_name().to_str() {
            names.push(name.to_owned());
        }
    }
    names.sort();
    let mut out = Vec::new();
    for name in names {
        if out.len() >= MAX_APPS {
            break;
        }
        if let Some(entry) = read_entry(apps_dir, &name).await {
            out.push(entry);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_paths() {
        assert!(valid_name("mail-view_2"));
        for bad in ["", "-x", "Up", "a/b", "..", "a.b", &"x".repeat(41)] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert_eq!(safe_relative("a/./b.txt"), Some(PathBuf::from("a/b.txt")));
        for bad in [
            "",
            "..",
            "../x",
            "a/../../x",
            "/etc/passwd",
            "a\\b",
            "a\0b",
            ".",
        ] {
            assert_eq!(safe_relative(bad), None, "{bad}");
        }
    }
}
