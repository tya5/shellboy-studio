//! One-time registration of Studio's bundled user guide in Core's docs catalogue.
use shellboy::docs::SourceCommand;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const SOURCE_NAME: &str = "studio";
const MARKER: &str = "studio-docs-source.json";

/// Install/update the bilingual Markdown at a stable path. Called on each Studio start.
pub fn install(data_dir: &Path, guide: &str) -> io::Result<PathBuf> {
    let folder = data_dir.join("studio").join("docs");
    fs::create_dir_all(&folder)?;
    fs::write(folder.join("user-guide.md"), guide)?;
    Ok(folder)
}

/// Register through the same Core docs/config implementation used by `shellboy docs source add`.
/// The marker is Studio-owned: once set, a user removal is respected across later starts/upgrades.
pub fn register_once(
    studio_config: &Path,
    core_config: &Path,
    source_folder: &Path,
) -> Result<(), String> {
    let marker = studio_config.join(MARKER);
    match fs::read(&marker) {
        Ok(bytes) => {
            let value: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|_| "invalid Studio docs-source marker".to_owned())?;
            if value.get("registered").and_then(|v| v.as_bool()) == Some(true) {
                return Ok(());
            }
            return Err("invalid Studio docs-source marker".into());
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let cwd = std::env::current_dir().map_err(|error| error.to_string())?;
    let response = shellboy::docs::source_response(
        SourceCommand::Add {
            name: SOURCE_NAME.into(),
            path: source_folder.to_owned(),
        },
        Some(core_config),
        &cwd,
    );
    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        let detail = response
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Core docs source registration failed");
        return Err(detail.into());
    }
    fs::create_dir_all(studio_config).map_err(|error| error.to_string())?;
    let temporary = studio_config.join(format!(".{MARKER}.{}.tmp", uuid::Uuid::new_v4()));
    let write = fs::write(&temporary, br#"{"registered":true}"#)
        .and_then(|()| fs::rename(&temporary, &marker));
    if write.is_err() {
        let _ = fs::remove_file(temporary);
    }
    write.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use shellboy::docs::DocsRead;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!(
            "studio-doc-source-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn registers_bilingual_guide_once_and_respects_user_removal() {
        let root = temp();
        let config_dir = root.join("studio-config");
        let core_config = root.join("config.toml");
        let data = root.join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(&core_config, "").unwrap();
        let folder = install(
            &data,
            "# Studio User Guide\n\n## English\nGuide.\n\n## 日本語\nガイド。\n",
        )
        .unwrap();
        register_once(&config_dir, &core_config, &folder).unwrap();
        let list = |parent: &str| {
            shellboy::docs::configured_response(
                DocsRead::List {
                    parent: Some(parent.into()),
                    sources: vec![],
                    limit: 50,
                    cursor: None,
                },
                Some(&core_config),
                &root,
            )
        };
        let docs = list("studio");
        assert_eq!(docs["ok"], true);
        assert!(
            docs["result"]["items"]
                .to_string()
                .contains("studio/user-guide")
        );
        let guide = shellboy::docs::configured_response(
            DocsRead::Get {
                id: "studio/user-guide.md".into(),
                sources: vec![],
                section: None,
                limit_bytes: 16384,
                cursor: None,
            },
            Some(&core_config),
            &root,
        );
        assert_eq!(guide["ok"], true);
        assert!(
            guide["result"]["text"]
                .as_str()
                .unwrap()
                .contains("## 日本語")
        );
        let removed = shellboy::docs::source_response(
            SourceCommand::Remove {
                name: SOURCE_NAME.into(),
            },
            Some(&core_config),
            &root,
        );
        assert_eq!(removed["ok"], true);
        let original_path = folder.clone();
        fs::write(folder.join("user-guide.md"), "old copy").unwrap();
        assert_eq!(install(&data, "# Upgraded Guide\n").unwrap(), original_path);
        assert!(
            fs::read_to_string(folder.join("user-guide.md"))
                .unwrap()
                .contains("Upgraded Guide")
        );
        register_once(&config_dir, &core_config, &folder).unwrap();
        assert!(
            !list("studio")["result"]["items"]
                .to_string()
                .contains("studio/user-guide")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
