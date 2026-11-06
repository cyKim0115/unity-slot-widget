//! Cheap change signals between full refreshes.
//!
//! A full `dashboard -Json` costs about a second of PowerShell CPU, so it runs every 30 s.
//! In between, this thread looks every few seconds at two things that cost a few ms:
//! the set of running Unity.exe process ids (ToolHelp snapshot, no process is started) and the
//! files in the slot home (registry, leases, events). When either changes, the page refreshes
//! at once. While the widget is hidden the thread does nothing.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

use crate::paths;

/// Seconds between looks. The page can change it from settings.
static INTERVAL_SECS: AtomicU64 = AtomicU64::new(3);

pub fn set_interval(secs: u64) {
    INTERVAL_SECS.store(secs.clamp(1, 60), Ordering::Relaxed);
}

/// Sorted ids of every running Unity.exe (editors, import workers, batch runs).
pub fn unity_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return pids;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if name.eq_ignore_ascii_case("Unity.exe") {
                    pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    pids.sort_unstable();
    pids
}

fn hash_file(h: &mut DefaultHasher, path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(h);
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .hash(h);
    } else {
        0u8.hash(h);
    }
}

fn signature() -> u64 {
    let mut h = DefaultHasher::new();
    unity_pids().hash(&mut h);
    let home = paths::slot_home();
    for name in ["slots.json", "events.jsonl", "install.json"] {
        hash_file(&mut h, &home.join(name));
    }
    if let Ok(entries) = std::fs::read_dir(home.join("leases")) {
        let mut names: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        names.sort();
        for path in names {
            path.file_name().hash(&mut h);
            hash_file(&mut h, &path);
        }
    }
    h.finish()
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<u64> = None;
        let mut was_visible = true;
        loop {
            std::thread::sleep(Duration::from_secs(INTERVAL_SECS.load(Ordering::Relaxed)));
            let visible = app
                .get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if !visible {
                was_visible = false;
                continue;
            }
            if !was_visible {
                was_visible = true;
                last = None;
                let _ = app.emit_to("main", "widget-shown", ());
                continue;
            }
            let sig = signature();
            if last.is_some_and(|prev| prev != sig) {
                let _ = app.emit_to("main", "slot-signal", ());
            }
            last = Some(sig);
        }
    });
}
