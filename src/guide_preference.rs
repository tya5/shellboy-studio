//! Bridge-owned opt-out: absent means registration is enabled.
use std::{fs, io, path::Path};

pub fn enabled(dir: &Path) -> io::Result<bool> {
    match fs::read_to_string(dir.join("guide-preference.json")) {
        Ok(value) => serde_json::from_str::<serde_json::Value>(&value)
            .ok()
            .and_then(|v| v.get("enabled").and_then(|x| x.as_bool()))
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid guide preference")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(error),
    }
}

pub fn set_enabled(dir: &Path, value: bool) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let temporary = dir.join(format!(".agent-guide-{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(
        &temporary,
        serde_json::json!({ "enabled": value }).to_string(),
    )
    .and_then(|()| fs::rename(&temporary, dir.join("guide-preference.json")));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn preference_is_persistent_and_invalid_values_fail_closed() {
        let dir = std::env::temp_dir().join(format!("studio-pref-{}", uuid::Uuid::new_v4()));
        assert!(super::enabled(&dir).unwrap());
        super::set_enabled(&dir, false).unwrap();
        assert!(!super::enabled(&dir).unwrap());
        std::fs::write(dir.join("guide-preference.json"), "bad").unwrap();
        assert!(super::enabled(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

/// Reconcile the pointer through the owner's public, hash-checked configuration API.
#[cfg(feature = "next-shellboy")]
pub async fn register<O: crate::owner::Owner>(
    owner: &O,
    config_dir: &Path,
    data_dir: &Path,
    instance: &str,
) -> Result<(), String> {
    use shellboy::protocol::{Command, ConfigChange, ConfigGetArgs, ConfigSetArgs};
    if !enabled(config_dir).map_err(|e| e.to_string())? {
        return Ok(());
    }
    let response = owner
        .call(Command::ConfigGet(ConfigGetArgs {}), None, None)
        .await
        .map_err(|e| e.message)?;
    if !response.ok {
        return Err(response
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "config.get failed".into()));
    }
    let result = response.result.ok_or("config.get missing result")?;
    let Some(file) = result.get("file") else {
        return Ok(());
    };
    if file.get("valid").and_then(|v| v.as_bool()) != Some(true) {
        return Err("configuration file is invalid".into());
    }
    let Some(paths) = file
        .pointer("/values/extra_instructions")
        .and_then(|v| v.as_array())
    else {
        return Ok(());
    };
    if !paths.iter().all(|p| p.is_string()) {
        return Err("invalid extra_instructions".into());
    }
    let pointer = data_dir.join("studio").join("agent-pointer.md");
    let pointer = pointer.to_str().ok_or("non-UTF-8 pointer path")?;
    if paths.iter().any(|p| p.as_str() == Some(pointer)) {
        return Ok(());
    }
    let hash = file
        .get("content_hash")
        .and_then(|v| v.as_str())
        .ok_or("config.get missing content hash")?;
    let mut paths = paths.clone();
    paths.push(serde_json::Value::String(pointer.to_owned()));
    let changes = vec![ConfigChange {
        field: "extra_instructions".into(),
        value: Some(serde_json::Value::Array(paths)),
    }];
    let response = owner
        .call(
            Command::ConfigSet(ConfigSetArgs {
                expected_hash: hash.into(),
                changes,
            }),
            Some(format!("{}:{}", instance, uuid::Uuid::new_v4())),
            None,
        )
        .await
        .map_err(|e| e.message)?;
    if !response.ok {
        return Err(response
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "config.set failed".into()));
    }
    Ok(())
}
