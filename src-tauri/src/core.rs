//! Runs `unity-slot dashboard -Json` and hands the document to the page as it is.
//!
//! The widget never decides anything about slots: the core owns the rules and the schema
//! (`unity-slot.dashboard/1`). This file only finds the core, runs it in a hidden window with a
//! time limit, and checks that the answer is a dashboard document.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
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

fn run_core(script: &str, git_level: &str) -> Result<serde_json::Value, String> {
    let level = if git_level == "full" { "full" } else { "basic" };
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "dashboard",
        "-Json",
        "-Git",
        level,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("spawn:{e}"))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    // Read both pipes on their own threads so a full pipe never blocks the child.
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
