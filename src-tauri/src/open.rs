//! Read-only helpers: open a slot folder in Fork, a terminal, an editor or Explorer, open its
//! editor log, bring an open editor's window to the front. Nothing here changes a slot, an editor
//! or a repository, and nothing starts Unity (Open in Unity goes through the core: core.rs).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use windows::core::{BOOL, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE, SW_SHOWNORMAL,
};

/// Programs a slot folder can be opened with (`openTarget` in widget.json). The first is the default.
pub const OPEN_TARGETS: [&str; 6] = ["fork", "cmd", "git_bash", "cursor", "vscode", "explorer"];

const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

/// Opens the slot folder with one of `OPEN_TARGETS`; anything else opens it in Fork.
/// The path goes in as an argument or the working folder, never through a shell command line.
/// Errors: `not-found` (no folder), `app-not-found` (program not installed), `spawn:<reason>`.
pub fn open_with(path: &str, target: &str) -> Result<(), String> {
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err("not-found".into());
    }
    match target {
        "explorer" => shell_open(&dir),
        // A new console window that starts in the slot folder.
        "cmd" => spawn(
            Command::new("cmd.exe")
                .arg("/K")
                .current_dir(&dir)
                .creation_flags(CREATE_NEW_CONSOLE),
        ),
        "git_bash" => {
            let exe = find_executable(git_bash_candidates())?;
            spawn(
                Command::new(exe)
                    .arg(format!("--cd={}", dir.display()))
                    .current_dir(&dir),
            )
        }
        "cursor" => open_in_editor(cursor_candidates(), "cursor", &dir),
        "vscode" => open_in_editor(vscode_candidates(), "code", &dir),
        _ => {
            let exe = find_executable(fork_candidates())?;
            spawn(Command::new(exe).arg(&dir))
        }
    }
}

/// Brings an open editor's window to the front (right-click > Show Unity window); a minimized one
/// is restored. The window: the largest visible top-level window of `pid` that has no owner.
/// The widget was just clicked, so Windows lets it hand the foreground over.
/// Errors: `window-not-found`.
pub fn focus_window(pid: u32) -> Result<(), String> {
    let hwnd = main_window(pid).ok_or_else(|| "window-not-found".to_string())?;
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    Ok(())
}

struct WindowSearch {
    pid: u32,
    best: Option<(HWND, i64)>,
}

fn main_window(pid: u32) -> Option<HWND> {
    if pid == 0 {
        return None;
    }
    let mut search = WindowSearch { pid, best: None };
    unsafe {
        let _ = EnumWindows(Some(visit_window), LPARAM(&mut search as *mut WindowSearch as isize));
    }
    search.best.map(|(hwnd, _)| hwnd)
}

unsafe extern "system" fn visit_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = unsafe { &mut *(lparam.0 as *mut WindowSearch) };
    let mut owner_pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner_pid)) };
    // GetWindow fails when the window has no owner: a main window, not a dialog or tool window.
    if owner_pid != search.pid || !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok() {
        return BOOL(1);
    }
    let mut r = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut r) }.is_ok() {
        let area = i64::from(r.right - r.left) * i64::from(r.bottom - r.top);
        if search.best.map_or(true, |(_, best)| area > best) {
            search.best = Some((hwnd, area));
        }
    }
    BOOL(1)
}

fn spawn(cmd: &mut Command) -> Result<(), String> {
    // The child is not waited for; dropping the handle leaves it running.
    cmd.spawn().map(|_| ()).map_err(|e| format!("spawn:{e}"))
}

/// The installed exe first; the `cursor`/`code` command on PATH (a .cmd) only when no exe is
/// found, without the console window cmd.exe would flash.
fn open_in_editor(candidates: Vec<PathBuf>, command: &str, dir: &Path) -> Result<(), String> {
    if let Ok(exe) = find_executable(candidates) {
        return spawn(Command::new(exe).arg(dir));
    }
    let cli = which_on_path(command).ok_or_else(|| "app-not-found".to_string())?;
    spawn(Command::new(cli).arg(dir).creation_flags(CREATE_NO_WINDOW))
}

fn fork_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = env_dir("LOCALAPPDATA") {
        // Squirrel / Velopack install from git-fork.com: ...\Fork\current\Fork.exe
        out.push(local.join("Fork").join("current").join("Fork.exe"));
        out.push(local.join("Fork").join("Fork.exe"));
    }
    for root in program_files() {
        out.push(root.join("Fork").join("Fork.exe"));
    }
    out
}

fn git_bash_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in program_files() {
        out.push(root.join("Git").join("git-bash.exe"));
    }
    if let Some(local) = env_dir("LOCALAPPDATA") {
        out.push(local.join("Programs").join("Git").join("git-bash.exe"));
    }
    // Git for Windows elsewhere: <Git>\cmd\git.exe sits next to <Git>\git-bash.exe.
    if let Some(root) = which_on_path("git").and_then(|git| git.parent()?.parent().map(Path::to_path_buf)) {
        out.push(root.join("git-bash.exe"));
    }
    out
}

fn cursor_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = env_dir("LOCALAPPDATA") {
        out.push(local.join("Programs").join("cursor").join("Cursor.exe"));
    }
    for root in program_files() {
        out.push(root.join("Cursor").join("Cursor.exe"));
    }
    out
}

fn vscode_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = env_dir("LOCALAPPDATA") {
        out.push(local.join("Programs").join("Microsoft VS Code").join("Code.exe"));
    }
    for root in program_files() {
        out.push(root.join("Microsoft VS Code").join("Code.exe"));
    }
    out
}

fn find_executable(candidates: Vec<PathBuf>) -> Result<PathBuf, String> {
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "app-not-found".to_string())
}

/// `name` plus each PATHEXT extension in each PATH folder, like cmd.exe looks it up.
fn which_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn program_files() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(|v| env_dir(v)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn missing(name: &str) -> PathBuf {
        std::env::temp_dir().join("unity-slot-widget-test-missing").join(name)
    }

    #[test]
    fn missing_folder_is_not_found() {
        let dir = missing("slot");
        assert_eq!(open_with(&dir.to_string_lossy(), "fork"), Err("not-found".to_string()));
    }

    #[test]
    fn no_window_for_a_missing_process() {
        assert_eq!(focus_window(0), Err("window-not-found".to_string()));
    }

    #[test]
    fn unknown_program_is_app_not_found() {
        assert_eq!(find_executable(vec![missing("app.exe")]), Err("app-not-found".to_string()));
    }

    /// Prints what this PC resolves; launches nothing. `cargo test -- --nocapture` to see it.
    #[test]
    fn resolves_installed_programs() {
        for (name, list) in [
            ("fork", fork_candidates()),
            ("git_bash", git_bash_candidates()),
            ("cursor", cursor_candidates()),
            ("vscode", vscode_candidates()),
        ] {
            println!("{name}: {:?}", find_executable(list));
        }
    }
}
