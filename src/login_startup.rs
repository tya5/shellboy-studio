//! Login registration belongs to the OS, not Studio config or Core.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum State {
    #[cfg(any(test, target_os = "macos"))]
    On,
    #[cfg(any(test, target_os = "macos", windows))]
    Off,
    #[cfg(any(test, target_os = "macos"))]
    Approval,
    Unknown,
    Unavailable,
    NoDesktopLauncher,
}

#[derive(Debug, Serialize)]
pub(crate) struct Readback {
    pub state: State,
    pub refused: bool,
}

#[cfg(any(test, target_os = "macos", windows))]
trait Registration {
    fn state(&self) -> State;
    fn set(&self, enabled: bool) -> Result<(), ()>;
}

#[cfg(any(test, target_os = "macos", windows))]
fn transact(adapter: &impl Registration, enabled: Option<bool>) -> Readback {
    let refused = enabled.is_some_and(|enabled| {
        let before = adapter.state();
        match before {
            State::Off if enabled => adapter.set(true).is_err(),
            #[cfg(any(test, target_os = "macos"))]
            State::On if !enabled => adapter.set(false).is_err(),
            #[cfg(any(test, target_os = "macos"))]
            State::On => false,
            State::Off => false,
            _ => true,
        }
    });
    Readback {
        state: adapter.state(),
        refused,
    }
}

pub(crate) fn desktop(enabled: Option<bool>) -> Readback {
    #[cfg(target_os = "macos")]
    return transact(&mac::MainApp, enabled);
    #[cfg(windows)]
    return transact(&win::Shortcut, enabled);
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = enabled;
        Readback {
            state: State::NoDesktopLauncher,
            refused: false,
        }
    }
}

#[cfg(any(test, target_os = "macos"))]
fn mac_state(status: Option<isize>) -> State {
    match status {
        Some(0) => State::Off,
        Some(1) => State::On,
        Some(2) => State::Approval,
        Some(3) => State::Unavailable,
        _ => State::Unknown,
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::ffi::{CStr, c_char, c_void};
    type Id = *mut c_void;

    #[link(name = "objc")]
    unsafe extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Id;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> Id;
        fn objc_autoreleasePoolPop(pool: Id);
    }

    // All sends are to SMAppService with its documented Objective-C signatures.
    fn with_service<T>(f: impl FnOnce(Id) -> T) -> Option<T> {
        let exe = std::env::current_exe().ok()?;
        let bin = exe.parent()?;
        let contents = bin.parent()?;
        if !bin.ends_with("MacOS")
            || !contents.ends_with("Contents")
            || contents.parent()?.extension()? != "app"
        {
            return None;
        }
        // The CLI also runs outside app bundles. Resolve the optional framework
        // only for the desktop app, and keep it loaded for Objective-C's lifetime.
        static LOADED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if !*LOADED.get_or_init(|| unsafe {
            !libc::dlopen(
                c"/System/Library/Frameworks/ServiceManagement.framework/ServiceManagement"
                    .as_ptr(),
                libc::RTLD_LAZY | libc::RTLD_LOCAL,
            )
            .is_null()
        }) {
            return None;
        }
        unsafe {
            let class = objc_getClass(c"SMAppService".as_ptr());
            if class.is_null() {
                return None;
            }
            let pool = objc_autoreleasePoolPush();
            let send: unsafe extern "C" fn(Id, Id) -> Id =
                std::mem::transmute(objc_msgSend as *const ());
            let app = send(class, sel_registerName(c"mainAppService".as_ptr()));
            let result = (!app.is_null()).then(|| f(app));
            objc_autoreleasePoolPop(pool);
            result
        }
    }

    pub(super) struct MainApp;
    impl Registration for MainApp {
        fn state(&self) -> State {
            mac_state(with_service(|app| unsafe {
                let send: unsafe extern "C" fn(Id, Id) -> isize =
                    std::mem::transmute(objc_msgSend as *const ());
                send(app, sel_registerName(c"status".as_ptr()))
            }))
        }
        fn set(&self, enabled: bool) -> Result<(), ()> {
            let selector: &CStr = if enabled {
                c"registerAndReturnError:"
            } else {
                c"unregisterAndReturnError:"
            };
            with_service(|app| unsafe {
                let send: unsafe extern "C" fn(Id, Id, *mut Id) -> bool =
                    std::mem::transmute(objc_msgSend as *const ());
                send(
                    app,
                    sel_registerName(selector.as_ptr()),
                    std::ptr::null_mut(),
                )
            })
            .filter(|ok| *ok)
            .map(|_| ())
            .ok_or(())
        }
    }
}

#[cfg(any(test, windows))]
fn shortcut_state(present: Option<bool>) -> State {
    // Windows can disable Startup items without removing their shortcuts. The
    // documented shortcut interface exposes presence, not the effective toggle.
    match present {
        Some(false) => State::Off,
        Some(true) | None => State::Unknown,
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{
        os::windows::{ffi::OsStringExt, process::CommandExt},
        path::PathBuf,
        process::Command,
    };
    use windows_sys::Win32::System::{
        SystemInformation::GetSystemDirectoryW, Threading::CREATE_NO_WINDOW,
    };

    const INIT: &str = r#"
$ErrorActionPreference = 'Stop'
$folder = [Environment]::GetFolderPath('Startup')
if (-not $folder -or -not [IO.Directory]::Exists($folder)) { exit 3 }
$link = [IO.Path]::Combine($folder, 'Shellboy Studio.lnk')
"#;
    const READ: &str = r#"
try { $null = [IO.File]::GetAttributes($link); exit 1 }
catch [IO.FileNotFoundException] { exit 0 }
catch { exit 3 }
"#;
    const ADD: &str = r#"
$staging = [IO.Directory]::CreateDirectory([IO.Path]::Combine($folder, [Guid]::NewGuid().ToString()))
$tmp = [IO.Path]::Combine($staging.FullName, 'Studio.lnk')
try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($tmp)
    $shortcut.TargetPath = $env:SHELLBOY_STUDIO_STARTUP_EXE
    $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($env:SHELLBOY_STUDIO_STARTUP_EXE)
    $shortcut.Save()
    [IO.File]::Move($tmp, $link)
} finally {
    [IO.File]::Delete($tmp)
    $staging.Delete()
}
"#;

    fn run(script: &str) -> Option<i32> {
        let mut sys = [0; 1024];
        let n = unsafe { GetSystemDirectoryW(sys.as_mut_ptr(), sys.len() as u32) } as usize;
        if n == 0 || n >= sys.len() {
            return None;
        }
        let ps = PathBuf::from(std::ffi::OsString::from_wide(&sys[..n]))
            .join(r"WindowsPowerShell\v1.0\powershell.exe");
        let exe = std::env::current_exe().ok()?;
        Command::new(ps)
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("{INIT}{script}"),
            ])
            .env("SHELLBOY_STUDIO_STARTUP_EXE", exe)
            .output()
            .ok()?
            .status
            .code()
    }

    pub(super) struct Shortcut;
    impl Registration for Shortcut {
        fn state(&self) -> State {
            shortcut_state(match run(READ) {
                Some(0) => Some(false),
                Some(1) => Some(true),
                _ => None,
            })
        }
        fn set(&self, enabled: bool) -> Result<(), ()> {
            (enabled && run(ADD) == Some(0)).then_some(()).ok_or(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    struct Fake {
        status: Cell<State>,
        after: State,
        fail: bool,
        calls: Cell<Vec<bool>>,
    }
    impl Registration for Fake {
        fn state(&self) -> State {
            self.status.get()
        }
        fn set(&self, enabled: bool) -> Result<(), ()> {
            let mut calls = self.calls.take();
            calls.push(enabled);
            self.calls.set(calls);
            self.status.set(self.after);
            if self.fail { Err(()) } else { Ok(()) }
        }
    }
    fn fake(status: State, after: State, fail: bool) -> Fake {
        Fake {
            status: Cell::new(status),
            after,
            fail,
            calls: Cell::default(),
        }
    }
    #[test]
    fn mac_main_app_status_and_refusal_readback() {
        assert_eq!(
            [Some(0), Some(1), Some(2), Some(3), None].map(mac_state),
            [
                State::Off,
                State::On,
                State::Approval,
                State::Unavailable,
                State::Unknown
            ]
        );
        let adapter = fake(State::On, State::On, true);
        let result = transact(&adapter, Some(false));
        assert!(result.refused);
        assert_eq!(result.state, State::On);
        assert_eq!(adapter.calls.take(), [false]);
        adapter.status.set(State::Off);
        assert_eq!(transact(&adapter, None).state, State::Off);
        assert!(adapter.calls.take().is_empty());
    }
    #[test]
    fn windows_shortcut_presence_is_not_enabled_and_not_recreated() {
        let adapter = fake(
            shortcut_state(Some(false)),
            shortcut_state(Some(true)),
            false,
        );
        let result = transact(&adapter, Some(true));
        assert_eq!(result.state, State::Unknown);
        assert!(!result.refused);
        assert_eq!(adapter.calls.take(), [true]);
        assert!(transact(&adapter, Some(true)).refused);
        assert!(adapter.calls.take().is_empty());
        adapter.status.set(shortcut_state(Some(false)));
        assert_eq!(transact(&adapter, None).state, State::Off);
        assert_eq!(shortcut_state(None), State::Unknown);
    }
}
