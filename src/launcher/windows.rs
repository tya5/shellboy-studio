use super::desktop::{OwnerEnvironment, io};
use std::{
    fs::{self, File, OpenOptions},
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::{FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    ptr::null_mut,
};
use tokio::process::{Child, Command as Process};
use windows_sys::Win32::{
    Foundation::FILETIME,
    Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT},
    System::Threading::{
        CREATE_NO_WINDOW, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::{MB_ICONERROR, MessageBoxW, SW_SHOWNORMAL},
    },
};

pub(super) fn bundled_core(exe: &Path) -> Result<PathBuf, String> {
    Ok(exe.with_file_name("shellboy.exe"))
}

pub(super) fn detach(command: &mut std::process::Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

pub(super) fn configure_owner(command: &mut Process, env: &OwnerEnvironment) {
    detach(command.as_std_mut());
    command.envs(env.vars.iter().cloned());
}

pub(super) async fn owner_environment(bin: &Path) -> Result<OwnerEnvironment, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let path =
        std::env::join_paths(std::iter::once(bin.into()).chain(std::env::split_paths(&path)))
            .map_err(io)?;
    Ok(OwnerEnvironment {
        vars: vec![("PATH".into(), path)],
        warning: None,
    })
}

pub(crate) fn protect_file(options: &mut OpenOptions, _: bool) {
    options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
}

pub(crate) fn check_file(file: &File) -> std::io::Result<()> {
    let meta = file.metadata()?;
    if meta.is_file() && meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        Ok(())
    } else {
        Err(std::io::Error::other("not a regular Studio file"))
    }
}

pub(super) fn check_directory(path: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() && meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        Ok(())
    } else {
        Err(std::io::Error::other("not a regular Studio directory"))
    }
}

pub(super) async fn process_start(pid: u32) -> Option<String> {
    // SAFETY: adopt the non-null process handle once; GetProcessTimes writes four valid FILETIMEs.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let _owned = OwnedHandle::from_raw_handle(handle);
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        // A terminated process can still have a queryable handle until the last handle closes.
        if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) == 0
            || exit.dwHighDateTime != 0
            || exit.dwLowDateTime != 0
        {
            return None;
        }
        Some(format!(
            "{:08x}{:08x}",
            creation.dwHighDateTime, creation.dwLowDateTime
        ))
    }
}

pub(super) async fn stop_child(child: Option<Child>) {
    if let Some(mut child) = child {
        // Tokio terminates through the owned Windows process handle, never a discovered PID.
        let _ = child.kill().await;
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

pub(super) async fn open_browser(url: &str) -> Result<(), String> {
    let verb = wide("open");
    let url = wide(url);
    // SAFETY: the wide strings are NUL-terminated and remain live through the call.
    let status = unsafe {
        ShellExecuteW(
            null_mut(),
            verb.as_ptr(),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if status as isize > 32 {
        Ok(())
    } else {
        Err("Could not open Studio in the default browser. Check Windows Default Apps and try again.".into())
    }
}

pub fn show_error(error: &str, dir: Option<&Path>) {
    let location = dir
        .map(|dir| dir.join("studio.log").display().to_string())
        .unwrap_or_else(|| "%APPDATA%\\shellboy-studio\\studio.log".into());
    let message = wide(&format!("{error}\n\nIf available, see {location}."));
    let title = wide("Shellboy Studio could not open");
    // SAFETY: both NUL-terminated buffers are live until the modal call returns.
    unsafe {
        MessageBoxW(null_mut(), message.as_ptr(), title.as_ptr(), MB_ICONERROR);
    }
}
