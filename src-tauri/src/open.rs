//! Read-only helpers: show a slot folder in Explorer, open its editor log.
//! Nothing here changes a slot, an editor or a repository.

use std::path::{Path, PathBuf};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn shell_open(target: &Path) -> Result<(), String> {
    let file = HSTRING::from(target.as_os_str());
    let verb = HSTRING::from("open");
    let result = unsafe {
        ShellExecuteW(None, &verb, &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    // ShellExecuteW returns a value greater than 32 on success.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("open-failed:{}", result.0 as isize))
    }
}

pub fn open_folder(path: &str) -> Result<(), String> {
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err("not-found".into());
    }
    shell_open(&dir)
}

/// The slot's own editor log (`<slot>\Logs\Editor.log`), the file unity-slot starts editors with.
pub fn open_log(slot_path: &str) -> Result<(), String> {
    let log = PathBuf::from(slot_path).join("Logs").join("Editor.log");
    if !log.is_file() {
        return Err("not-found".into());
    }
    shell_open(&log)
}
