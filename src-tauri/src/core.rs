//! Runs `unity-slot dashboard -Json` and hands the document to the page as it is, and runs
//! `unity-slot open <slot> -NoWait` for a slot card's right-click > Open in Unity.
//!
//! The widget never decides anything about slots: the core owns the rules and the schema
//! (`unity-slot.dashboard/1`). This file only finds the core, runs it in a hidden window with a
//! time limit, and checks that the answer is a dashboard document. Opening goes through the core
//! too, so its checks (already open, batchmode run, held lock, missing Unity version, capacity
//! warnings) and its WMI launch apply; the widget never starts Unity.exe itself.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::paths;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const TIMEOUT: Duration = Duration::from_secs(20);
const SCHEMA_PREFIX: &str = "unity-slot.dashboard/";

/// One run at a time: a slow core must not pile up PowerShell processes.
static RUNNING: AtomicBool = AtomicBool::new(false);

/// `open -NoWait` launches and returns; it reads git and the commit charge first (a few seconds).
const OPEN_TIMEOUT: Duration = Duration::from_secs(90);

/// One open at a time. Held until the core's process ends, even after the widget stopped waiting,
/// so a second click cannot start a second editor while the first run is still launching one.
static OPENING: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardResult {
    pub document: serde_json::Value,
    /// Wall time of the whole call, in ms.
    pub ms: u64,
    /// core | sample
    pub source: String,
    pub script: Option<String>,
}

/// Errors are short codes the page translates: `busy`, `core-not-found`, `timeout`,
/// `spawn:<text>`, `exit:<code>:<stderr>`, `parse:<text>`, `schema:<value>`, `sample:<text>`.
pub fn dashboard(git_level: &str, setting_script: &str, sample: Option<String>) -> Result<DashboardResult, String> {
    let started = Instant::now();
    if let Some(path) = sample.filter(|p| !p.trim().is_empty()) {
        let text = std::fs::read_to_string(path.trim()).map_err(|e| format!("sample:{e}"))?;
        let document = parse(&text)?;
        return Ok(DashboardResult {
            document,
            ms: started.elapsed().as_millis() as u64,
            source: "sample".into(),
            script: Some(path),
        });
    }

    let location = paths::locate_core(setting_script);
    let script = location.script.ok_or_else(|| "core-not-found".to_string())?;
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err("busy".into());
    }
    let result = run_core(&script, git_level);
    RUNNING.store(false, Ordering::Release);
    let document = result?;
    Ok(DashboardResult {
        document,
        ms: started.elapsed().as_millis() as u64,
        source: "core".into(),
        script: Some(script),
    })
}

/// `powershell.exe -File <script> <args>` in a hidden window, both pipes read on their own threads
/// so a full pipe never blocks the child.
struct CoreRun {
    child: Child,
    out_reader: JoinHandle<Vec<u8>>,
    err_reader: JoinHandle<Vec<u8>>,
}

fn start_core(script: &str, args: &[&str], person: bool) -> Result<CoreRun, String> {
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if person {
        // A person clicked: the core's event log names them (user@PC), not an agent session the
        // widget may have been started from.
        cmd.env_remove("CLAUDE_CODE_SESSION_ID").env_remove("CODEX_THREAD_ID");
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("spawn:{e}"))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    Ok(CoreRun { child, out_reader, err_reader })
}

fn run_core(script: &str, git_level: &str) -> Result<serde_json::Value, String> {
    let level = if git_level == "full" { "full" } else { "basic" };
    let CoreRun { mut child, out_reader, err_reader } =
        start_core(script, &["dashboard", "-Json", "-Git", level], false)?;

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                // Our own PowerShell child only; it never touches an editor.
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(format!("spawn:{e}")),
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    if !status.success() {
        let text = String::from_utf8_lossy(&err);
        let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
        let code = status.code().unwrap_or(-1);
        return Err(format!("exit:{code}:{}", first.chars().take(300).collect::<String>()));
    }
    parse(&String::from_utf8_lossy(&out))
}

fn parse(text: &str) -> Result<serde_json::Value, String> {
    let text = text.trim_start_matches('\u{feff}');
    let start = text.find('{').ok_or_else(|| "parse:no json object".to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(text[start..].trim_end()).map_err(|e| format!("parse:{e}"))?;
    let schema = value.get("schema").and_then(|s| s.as_str()).unwrap_or("");
    if !schema.starts_with(SCHEMA_PREFIX) {
        return Err(format!("schema:{schema}"));
    }
    Ok(value)
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    /// `started` (the core launched the editor), `already-open`, or `done` (exit 0, neither line).
    pub outcome: String,
    pub pid: Option<u32>,
    /// `warn capacity: ...` lines as the core wrote them (many editors, high commit charge).
    /// The core only warns; the editor is started anyway.
    pub warnings: Vec<String>,
}

/// `unity-slot open <slot path> -NoWait`: the core checks the clone and starts the editor through WMI,
/// with no `-BuildTarget` (the platform in the clone's Library stays as it is).
/// Errors: `not-found`, `busy` (another open still runs), `core-not-found`, `timeout` (the core is
/// left running, not killed; the next refresh shows what it did), `spawn:<text>`,
/// `unity-missing:<version>`, `batch-busy`, `lock-held`, `refused:<text>`, `exit:<code>:<text>`.
pub fn open_slot(setting_script: &str, path: &str) -> Result<OpenResult, String> {
    let path = path.trim();
    if path.is_empty() || !std::path::Path::new(path).is_dir() {
        return Err("not-found".into());
    }
    let location = paths::locate_core(setting_script);
    let script = location.script.ok_or_else(|| "core-not-found".to_string())?;
    if OPENING.swap(true, Ordering::AcqRel) {
        return Err("busy".into());
    }
    let CoreRun { mut child, out_reader, err_reader } = match start_core(&script, &["open", path, "-NoWait"], true) {
        Ok(run) => run,
        Err(e) => {
            OPENING.store(false, Ordering::Release);
            return Err(e);
        }
    };

    let deadline = Instant::now() + OPEN_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                // It may be launching the editor right now: never kill it. Free the next open
                // only when it has ended.
                std::thread::spawn(move || {
                    let _ = child.wait();
                    let _ = out_reader.join();
                    let _ = err_reader.join();
                    OPENING.store(false, Ordering::Release);
                });
                return Err("timeout".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => {
                OPENING.store(false, Ordering::Release);
                return Err(format!("spawn:{e}"));
            }
        }
    };
    OPENING.store(false, Ordering::Release);
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    open_outcome(status.code().unwrap_or(-1), &String::from_utf8_lossy(&out), &String::from_utf8_lossy(&err))
}

/// The core's `[open] ...` lines, without the prefix.
fn core_lines(text: &str) -> Vec<String> {
    text.trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .map(|l| l.strip_prefix("[open]").map(str::trim_start).unwrap_or(l))
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// Exit codes of `open`: 0 started or already open, 1 error, 3 Unity version not installed,
/// 4 refused (batchmode run, held lock, platform switch).
fn open_outcome(code: i32, stdout: &str, stderr: &str) -> Result<OpenResult, String> {
    let lines = core_lines(stdout);
    let find = |prefix: &str| lines.iter().find(|l| l.starts_with(prefix)).map(String::as_str);
    if code == 0 {
        let warnings = lines.iter().filter(|l| l.starts_with("warn capacity:")).cloned().collect();
        let (outcome, pid) = if let Some(l) = find("STARTED pid ") {
            ("started", pid_after(l, "STARTED pid "))
        } else if let Some(l) = find("ALREADY OPEN pid ") {
            ("already-open", pid_after(l, "ALREADY OPEN pid "))
        } else {
            ("done", None)
        };
        return Ok(OpenResult { outcome: outcome.into(), pid, warnings });
    }
    if let Some(rest) = find("STOP: Unity ").and_then(|l| l.strip_prefix("STOP: Unity ")) {
        if rest.contains("is not installed") {
            let version = rest.split_whitespace().next().unwrap_or("?");
            return Err(format!("unity-missing:{version}"));
        }
    }
    if find("BUSY:").is_some() {
        return Err("batch-busy".into());
    }
    if find(r"STOP: Temp\UnityLockfile is held").is_some() {
        return Err("lock-held".into());
    }
    if let Some(l) = find("REFUSED:") {
        return Err(format!("refused:{}", short(l["REFUSED:".len()..].trim())));
    }
    let text = find("ERROR:")
        .map(|l| l["ERROR:".len()..].trim().to_string())
        .or_else(|| stderr.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string))
        .or_else(|| lines.last().cloned())
        .unwrap_or_default();
    Err(format!("exit:{code}:{}", short(&text)))
}

fn pid_after(line: &str, prefix: &str) -> Option<u32> {
    line.strip_prefix(prefix)?.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

fn short(text: &str) -> String {
    text.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn started_with_capacity_warning() {
        let out = concat!(
            r"[open] clone   C:\slots\MyGame-2", "\r\n",
            "[open] version 6000.0.1f1\r\n",
            "[open] warn capacity: 4 editors are already open (maxEditors 4); this one makes 5. Close one.\r\n",
            r#"[open] started pid 4120 at 10:00:00: "Unity.exe" -projectPath ..."#, "\r\n",
            r#"[open] STARTED pid 4120; not waiting here. Run "unity-slot wait C:\slots\MyGame-2" until it says READY."#, "\r\n",
        );
        let r = open_outcome(0, out, "").unwrap();
        assert_eq!(r.outcome, "started");
        assert_eq!(r.pid, Some(4120));
        assert_eq!(r.warnings.len(), 1);
        assert!(r.warnings[0].starts_with("warn capacity: 4 editors"));
    }

    #[test]
    fn already_open() {
        let out = concat!(
            r"[open] clone   C:\slots\MyGame-2", "\n",
            "[open] ALREADY OPEN pid 77 since 09:00:00 (direct launch), 1 import worker(s). Use this editor.\n",
        );
        let r = open_outcome(0, out, "").unwrap();
        assert_eq!((r.outcome.as_str(), r.pid), ("already-open", Some(77)));
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn refusals_become_codes() {
        let missing = r"[open] STOP: Unity 6000.0.1f1 is not installed under the editor roots (C:\Unity).";
        assert_eq!(open_outcome(3, missing, ""), Err("unity-missing:6000.0.1f1".to_string()));
        let batch = "[open] BUSY: batchmode Unity pid 9 is using this clone. Wait until it quits.";
        assert_eq!(open_outcome(4, batch, ""), Err("batch-busy".to_string()));
        let lock = r"[open] STOP: Temp\UnityLockfile is held, but no Unity.exe has this clone as -projectPath.";
        assert_eq!(open_outcome(4, lock, ""), Err("lock-held".to_string()));
        let error = r"[open] ERROR: not a Unity project (Assets and ProjectSettings expected): C:\slots\x";
        assert_eq!(
            open_outcome(1, error, ""),
            Err(r"exit:1:not a Unity project (Assets and ProjectSettings expected): C:\slots\x".to_string())
        );
        assert_eq!(open_outcome(1, "", "boom\n"), Err("exit:1:boom".to_string()));
    }
}
