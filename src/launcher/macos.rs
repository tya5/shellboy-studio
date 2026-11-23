use super::desktop::{OwnerEnvironment, io};
use crate::auth::random_hex;
use std::{
    ffi::OsString,
    fs::{File, OpenOptions},
    os::unix::{ffi::OsStringExt, fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::{Child, Command as Process},
    time::timeout,
};

pub(super) fn bundled_core(exe: &Path) -> Result<PathBuf, String> {
    Ok(exe
        .parent()
        .and_then(Path::parent)
        .ok_or("Studio is not in its application bundle")?
        .join("Resources/bin/shellboy"))
}

pub(super) fn detach(command: &mut std::process::Command) {
    command.process_group(0);
}
pub(super) fn configure_owner(command: &mut Process, env: &OwnerEnvironment) {
    command.env_clear().envs(env.vars.iter().cloned());
}
pub(super) fn protect_file(options: &mut OpenOptions, private: bool) {
    options.custom_flags(0x100 | 0x4); // O_NOFOLLOW | O_NONBLOCK
    if private {
        options.mode(0o600);
    }
}
pub(super) fn check_file(file: &File) -> std::io::Result<()> {
    if file.metadata()?.is_file() {
        Ok(())
    } else {
        Err(std::io::Error::other("not a regular file"))
    }
}
pub(super) fn check_directory(_: &Path) -> std::io::Result<()> {
    Ok(())
}

fn decode_env(bytes: &[u8], marker: &[u8]) -> Option<Vec<(OsString, OsString)>> {
    let offset = bytes.windows(marker.len()).position(|w| w == marker)? + marker.len();
    let entries = bytes.get(offset..)?.strip_suffix(&[0])?;
    let mut env = Vec::new();
    for entry in entries.split(|&b| b == 0) {
        let split = entry.iter().position(|&b| b == b'=')?;
        if split == 0 {
            return None;
        }
        env.push((
            OsString::from_vec(entry[..split].to_vec()),
            OsString::from_vec(entry[split + 1..].to_vec()),
        ));
    }
    Some(env)
}

pub(super) async fn owner_environment(bin: &Path) -> Result<OwnerEnvironment, String> {
    let result = async {
        let shell = std::env::var_os("SHELL")?;
        if !Path::new(&shell).is_absolute() {
            return None;
        }
        let marker = random_hex().ok()?;
        let mut child = Process::new(shell)
            .arg("-lic")
            .arg(format!("printf '%s' '{marker}'; exec /usr/bin/env -0"))
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .ok()?;
        let mut bytes = Vec::new();
        child
            .stdout
            .take()?
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .ok()?;
        if bytes.len() > 1024 * 1024 || !child.wait().await.ok()?.success() {
            return None;
        }
        decode_env(&bytes, marker.as_bytes())
    };
    let captured = timeout(Duration::from_secs(5), result).await.ok().flatten();
    let warning = captured.is_none().then(|| {
        "Could not capture the login-shell environment; using a minimal environment.".into()
    });
    let mut env = captured.unwrap_or_else(|| {
        ["HOME", "USER", "LOGNAME", "TMPDIR"]
            .into_iter()
            .filter_map(|key| std::env::var_os(key).map(|v| (key.into(), v)))
            .collect()
    });
    let path = env
        .iter()
        .rev()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| v.clone())
        .unwrap_or_else(|| "/usr/bin:/bin:/usr/sbin:/sbin".into());
    env.retain(|(key, _)| {
        !["PATH", "SHELLBOY_DATA_DIR", "SHELLBOY_CONFIG"]
            .iter()
            .any(|name| key == *name)
    });
    let mut path_with_core = bin.as_os_str().to_os_string();
    path_with_core.push(":");
    path_with_core.push(path);
    env.push(("PATH".into(), path_with_core));
    Ok(OwnerEnvironment { vars: env, warning })
}

pub(super) async fn stop_child(child: Option<Child>, _data_dir: &Path, _instance_id: Option<&str>) {
    let Some(mut child) = child else {
        return;
    };
    if let Some(pid) = child.id() {
        // Only signal the unreaped child, never an owner identified by discovery.
        let _ = Process::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await;
    }
    if timeout(Duration::from_secs(15), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}

pub(super) async fn process_start(pid: u32) -> Option<String> {
    let out = timeout(
        Duration::from_secs(1),
        Process::new("/bin/ps")
            .args(["-o", "lstart=", "-p", &pid.to_string()])
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|s| !s.is_empty())
}

pub(super) async fn open_browser(url: &str) -> Result<(), String> {
    let status = Process::new("/usr/bin/open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(io)?;
    if !status.success() {
        return Err("Could not open Studio in the default browser".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_framing_ignores_shell_banners_and_preserves_newlines() {
        let env = decode_env(
            b"startup output\nRANDOM_PATH=/bin\0VALUE=a\nb=c\0",
            b"RANDOM_",
        )
        .unwrap();
        assert_eq!(
            env,
            vec![
                ("PATH".into(), "/bin".into()),
                ("VALUE".into(), "a\nb=c".into())
            ]
        );
        assert!(decode_env(b"RANDOM_PATH=/bin", b"RANDOM_").is_none());
        assert!(decode_env(b"banner\nPATH=/bin\0", b"RANDOM_").is_none());
    }
}
