//! Finding apps: Core's `artifact.list` and `artifact.get` are the only registry. An app is an artifact
//! whose latest version URI uses the `shellboy-app:` scheme; nothing is cached or kept here.
use serde::Serialize;
use serde_json::Value;
use shellboy::protocol::{ArtifactGetArgs, ArtifactListArgs, Command};
use std::path::{Component, Path, PathBuf};

pub const MAX_APPS: usize = 64;
/// `artifact.list` serves 1 to 32 rows a page (Core's `docs/design/thread-artifacts.md`).
const LIST_PAGE: u32 = 32;
const SCHEME: &str = "shellboy-app";

/// What a listing shows. `name` is the artifact ID, which also names the route and the sender label.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppEntry {
    pub name: String,
    pub title: String,
    pub thread: String,
}

/// The latest saved version of an artifact, as the owner reports it.
#[derive(Debug, Clone)]
pub struct Latest {
    pub artifact: String,
    pub thread: String,
    pub title: String,
    pub version: i64,
    pub uri: String,
    pub mime: Option<String>,
}

/// What a version URI means to Studio. The owner decides what may be read; this only decides which
/// door the Web UI opens it by.
#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    /// A `shellboy-app:` folder: `index.html` and the files it loads, with the app API.
    App(PathBuf),
    /// Any other artifact of type `text/html`: one static page, without the API or its neighbours.
    Page,
}

impl Latest {
    pub fn kind(&self) -> Option<Kind> {
        if let Some(folder) = app_folder(&self.uri) {
            return Some(Kind::App(folder));
        }
        let html = self.mime.as_deref().is_some_and(|mime| {
            mime.split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .eq_ignore_ascii_case("text/html")
        });
        // The owner reads only local files; anything else it would refuse is not offered as a page.
        let local = Path::new(&self.uri).is_absolute() || has_scheme(&self.uri, "file");
        (html && local).then_some(Kind::Page)
    }
}

fn has_scheme(uri: &str, scheme: &str) -> bool {
    uri.get(..scheme.len() + 1).is_some_and(|head| {
        head[..scheme.len()].eq_ignore_ascii_case(scheme) && head.ends_with(':')
    })
}

/// The folder of a `shellboy-app:` URI. The scheme is compared without case and the rest must be an
/// absolute path, as Core requires.
pub fn app_folder(uri: &str) -> Option<PathBuf> {
    has_scheme(uri, SCHEME)
        .then(|| PathBuf::from(&uri[SCHEME.len() + 1..]))
        .filter(|folder| folder.is_absolute())
}

fn latest_of(value: &Value) -> Option<Latest> {
    let text = |at: &str| value.pointer(at).and_then(Value::as_str).map(str::to_owned);
    Some(Latest {
        artifact: text("/artifact_id")?,
        thread: text("/thread_id")?,
        title: text("/latest/title")?,
        version: value.pointer("/latest/version")?.as_i64()?,
        uri: text("/latest/uri")?,
        mime: text("/latest/mime"),
    })
}

/// A path inside an app: relative, with no way out of it. Core refuses the rest when it reads.
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

/// One artifact's latest version. The owner's error is returned as it came.
pub async fn latest<F, Fut>(call: &F, artifact: &str) -> Result<Latest, Value>
where
    F: Fn(Command) -> Fut,
    Fut: std::future::Future<Output = Result<Value, Value>>,
{
    let value = call(Command::ArtifactGet(ArtifactGetArgs {
        artifact_id: artifact.to_owned(),
        version: None,
        cursor: None,
        limit: Some(1),
    }))
    .await?;
    latest_of(&value)
        .filter(|found| found.artifact == artifact)
        .ok_or_else(|| serde_json::json!({"code": "invalid_reply", "message": "The owner's artifact reply was not understood"}))
}

/// One Core page of a Thread's artifacts, most recently updated first: the apps in it and Core's cursor
/// for the next page, if any. The person decides how far to read.
pub async fn list<F, Fut>(
    call: &F,
    thread: &str,
    cursor: Option<String>,
) -> Result<(Vec<AppEntry>, Option<String>), Value>
where
    F: Fn(Command) -> Fut,
    Fut: std::future::Future<Output = Result<Value, Value>>,
{
    let page = call(Command::ArtifactList(ArtifactListArgs {
        thread_id: thread.to_owned(),
        cursor,
        limit: LIST_PAGE,
    }))
    .await?;
    let apps = page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(latest_of)
        .filter(|found| matches!(found.kind(), Some(Kind::App(_))))
        .map(|found| AppEntry {
            name: found.artifact,
            title: found.title,
            thread: found.thread,
        })
        .collect();
    Ok((apps, page["next_cursor"].as_str().map(str::to_owned)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folders_and_paths() {
        let folder = std::env::temp_dir().join("kanban");
        let uri = format!("shellboy-app:{}", folder.display());
        assert_eq!(app_folder(&uri), Some(folder.clone()));
        assert_eq!(
            app_folder(&format!("Shellboy-App:{}", folder.display())),
            Some(folder),
            "the scheme has no case"
        );
        for bad in [
            "shellboy-app:relative",
            "file:///x",
            "/x",
            "shellboy-app",
            "",
        ] {
            assert_eq!(app_folder(bad), None, "{bad}");
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
