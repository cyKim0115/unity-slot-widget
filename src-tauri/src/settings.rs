//! Widget settings in `<slot home>\widget.json`.
//!
//! Kept next to the slot registry (not in AppData) so the file is the same for the user, their
//! terminal and agents. The window position alone stays with the window-state plugin.

use serde::{Deserialize, Serialize};

use crate::paths;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    /// auto | ko | en
    pub language: String,
    pub always_on_top: bool,
    pub glass: bool,
    pub glass_blur: f64,
    /// Seconds between full refreshes while nothing is starting.
    pub idle_secs: u64,
    /// Seconds between full refreshes while an editor is starting.
    pub starting_secs: u64,
    /// Minutes between refreshes that also count local-only git state (`-Git full`).
    pub git_full_mins: u64,
    /// Seconds between cheap change signals (process ids, slot files).
    pub signal_secs: u64,
    pub commit_warn_percent: u32,
    pub commit_critical_percent: u32,
    pub slot_memory_warn_gb: f64,
    pub local_only_warn_days: u32,
    pub local_only_critical_days: u32,
    /// Program for a slot card's right-click > Open: one of `open::OPEN_TARGETS` (default fork).
    pub open_target: String,
    /// Empty: find the core through install.json, then PATH.
    pub unity_slot_script: String,
    /// Developers and screenshots only: read this dashboard JSON instead of running the core.
    pub sample_file: String,
}

impl Default for WidgetSettings {
    fn default() -> Self {
        Self {
            language: "auto".into(),
            always_on_top: true,
            glass: false,
            glass_blur: crate::glass::DEFAULT_BLUR_PX,
            idle_secs: 30,
            starting_secs: 5,
            git_full_mins: 5,
            signal_secs: 3,
            commit_warn_percent: 85,
            commit_critical_percent: 90,
            slot_memory_warn_gb: 10.0,
            local_only_warn_days: 3,
            local_only_critical_days: 14,
            open_target: crate::open::OPEN_TARGETS[0].into(),
            unity_slot_script: String::new(),
            sample_file: String::new(),
        }
    }
}

impl WidgetSettings {
    fn clamp(mut self) -> Self {
        self.idle_secs = self.idle_secs.clamp(10, 600);
        self.starting_secs = self.starting_secs.clamp(2, 60);
        self.git_full_mins = self.git_full_mins.clamp(1, 120);
        self.signal_secs = self.signal_secs.clamp(1, 60);
        self.commit_warn_percent = self.commit_warn_percent.clamp(50, 99);
        self.commit_critical_percent = self.commit_critical_percent.clamp(self.commit_warn_percent, 100);
        self.glass_blur = self.glass_blur.clamp(0.0, crate::glass::MAX_BLUR_PX);
        if !matches!(self.language.as_str(), "auto" | "ko" | "en") {
            self.language = "auto".into();
        }
        if !crate::open::OPEN_TARGETS.contains(&self.open_target.as_str()) {
            self.open_target = crate::open::OPEN_TARGETS[0].into();
        }
        self
    }
}

fn file() -> std::path::PathBuf {
    paths::slot_home().join("widget.json")
}

pub fn load() -> WidgetSettings {
    let mut s: WidgetSettings = std::fs::read_to_string(file())
        .ok()
        .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default();
    // A sample file can also come from the environment (development, screenshots).
    if s.sample_file.trim().is_empty() {
        if let Ok(v) = std::env::var("UNITY_SLOT_WIDGET_SAMPLE") {
            s.sample_file = v;
        }
    }
    s.clamp()
}

pub fn save(settings: WidgetSettings) -> Result<WidgetSettings, String> {
    let settings = settings.clamp();
    let path = file();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(settings)
}
