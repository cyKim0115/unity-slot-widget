//! Where unity-slot keeps its state, and where the core script is.
//!
//! The state folder is `UNITY_SLOT_HOME`, or `%USERPROFILE%\.unity-slot`, the same rule the
//! core uses. It is outside AppData on purpose: packaged (MSIX) shells see a private copy of
//! AppData, so agents and this widget would not see the same files there.

use std::path::{Path, PathBuf};

pub fn slot_home() -> PathBuf {
    if let Some(home) = std::env::var_os("UNITY_SLOT_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(home);
    }
    let profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    profile.join(".unity-slot")
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreLocation {
    /// Full path of unity-slot.ps1, when found.
    pub script: Option<String>,
    /// setting | env | install.json | path | none
    pub source: String,
    pub slot_home: String,
}

fn existing_file(p: &Path) -> Option<PathBuf> {
    p.is_file().then(|| p.to_path_buf())
}

/// A `.ps1` path, or a folder / `unity-slot.cmd` next to `unity-slot.ps1`.
fn script_from(value: &str) -> Option<PathBuf> {
    let value = value.trim().trim_matches('"');
    if value.is_empty() {
        return None;
    }
    let p = PathBuf::from(value);
    if p.is_dir() {
        return existing_file(&p.join("unity-slot.ps1"));
    }
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
        Some(ext) if ext == "ps1" => existing_file(&p),
        Some(ext) if ext == "cmd" || ext == "bat" => p.parent().and_then(|d| existing_file(&d.join("unity-slot.ps1"))),
        _ => None,
    }
}

/// The core writes `<slot home>\install.json` (`{"script": ..., "version": ..., "schema": 1}`)
/// whenever it runs, so the widget needs no setting on a fresh PC.
fn script_from_install_json(home: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(home.join("install.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    script_from(value.get("script")?.as_str()?)
}

fn script_from_path_env() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        existing_file(&dir.join("unity-slot.ps1")).or_else(|| {
            dir.join("unity-slot.cmd")
                .is_file()
                .then(|| existing_file(&dir.join("unity-slot.ps1")))
                .flatten()
        })
    })
}

pub fn locate_core(setting: &str) -> CoreLocation {
    let home = slot_home();
    let found = script_from(setting)
        .map(|p| (p, "setting"))
        .or_else(|| {
            std::env::var("UNITY_SLOT_SCRIPT")
                .ok()
                .and_then(|v| script_from(&v))
                .map(|p| (p, "env"))
        })
        .or_else(|| script_from_install_json(&home).map(|p| (p, "install.json")))
        .or_else(|| script_from_path_env().map(|p| (p, "path")));
    CoreLocation {
        script: found.as_ref().map(|(p, _)| p.display().to_string()),
        source: found.map(|(_, s)| s.to_string()).unwrap_or_else(|| "none".into()),
        slot_home: home.display().to_string(),
    }
}
