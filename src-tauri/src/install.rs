//! 「Start with Windows」 (HKCU Run key). Off unless the user turns it on in settings.
//!
//! The entry points at the exe that is running, so it works for the `시작.bat` install
//! (`%LOCALAPPDATA%\UnitySlotWidget`) and for the release installer alike. A debug build is
//! never registered.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use std::path::{Path, PathBuf};

const AUTOSTART_NAME: &str = "Unity Slot Widget";

fn is_debug_exe(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str() == "debug")
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| e.to_string())
}

fn build(exe: &Path) -> Result<AutoLaunch, String> {
    AutoLaunchBuilder::new()
        .set_app_name(AUTOSTART_NAME)
        .set_app_path(&exe.display().to_string())
        .set_args(&["--from-autostart"])
        .build()
        .map_err(|e| e.to_string())
}

pub fn enable() -> Result<(), String> {
    let exe = current_exe()?;
    if cfg!(debug_assertions) || is_debug_exe(&exe) {
        return Err("debug-build".into());
    }
    build(&exe)?.enable().map_err(|e| e.to_string())
}

pub fn disable() -> Result<(), String> {
    let exe = current_exe()?;
    build(&exe)?.disable().map_err(|e| e.to_string())
}

pub fn is_enabled() -> Result<bool, String> {
    let exe = current_exe()?;
    match build(&exe) {
        Ok(al) => al.is_enabled().map_err(|e| e.to_string()),
        Err(_) => Ok(false),
    }
}

/// A debug run must never stay in the Run key (an earlier dev session may have left one).
pub fn cleanup_debug_entry() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
    use winreg::RegKey;
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_ALL_ACCESS)
    {
        if let Ok(val) = key.get_value::<String, _>(AUTOSTART_NAME) {
            let lower = val.to_lowercase();
            if lower.contains(r"\debug\") || lower.contains("/debug/") {
                let _ = key.delete_value(AUTOSTART_NAME);
            }
        }
    }
}
