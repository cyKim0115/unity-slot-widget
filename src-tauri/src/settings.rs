//! Widget settings in `<slot home>\widget.json`.
//!
//! Kept next to the slot registry (not in AppData) so the file is the same for the user, their
//! terminal and agents. Because others write it too, the app never writes its whole copy back:
//! [`update`] reads the file again, merges only the keys that changed, clamps them and replaces the
//! file through a temporary one. Keys this build does not know stay as they are and are not read
//! (the old `alwaysOnTop`, the old background-blur keys, anything a person or a newer build added).
//! A value that cannot be read falls back to its own default only.
//! The window position and size stay with the window-state plugin.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::paths;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    /// auto | ko | en
    pub language: String,
    /// Main window always on top (the title bar pin). The old `alwaysOnTop` key is not read.
    pub window_on_top: bool,
    /// The close box: quit | tray (hide to the notification area).
    pub close_action: String,
    /// Started by Windows (`--from-autostart`): show the window minimized.
    pub start_minimized: bool,
    /// system | light | dark
    pub theme: String,
    /// Theme fade in milliseconds (0 switches at once).
    pub theme_duration_ms: u64,
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
    /// Flash the taskbar button when a new risk appears (a stalled start, critical commit charge).
    pub flash_taskbar: bool,
    /// Program for a slot's right-click > Open: one of `open::OPEN_TARGETS` (default fork).
    pub open_target: String,
    /// Open the branch view repository in Fork after refreshing it.
    pub branch_view_open_fork: bool,
    /// Empty: find the core through install.json, then PATH.
    pub unity_slot_script: String,
    /// Developers and screenshots only: read this dashboard JSON instead of running the core.
    pub sample_file: String,
}

/// Every key of [`WidgetSettings`] in the order the file lists them (a test keeps it complete).
pub const KEYS: [&str; 20] = [
    "language",
    "windowOnTop",
    "closeAction",
    "startMinimized",
    "theme",
    "themeDurationMs",
    "idleSecs",
    "startingSecs",
    "gitFullMins",
    "signalSecs",
    "commitWarnPercent",
    "commitCriticalPercent",
    "slotMemoryWarnGb",
    "localOnlyWarnDays",
    "localOnlyCriticalDays",
    "flashTaskbar",
    "openTarget",
    "branchViewOpenFork",
    "unitySlotScript",
    "sampleFile",
];

/// A development sample given in the environment. Never stored in the settings.
pub const SAMPLE_ENV: &str = "UNITY_SLOT_WIDGET_SAMPLE";

impl Default for WidgetSettings {
    fn default() -> Self {
        Self {
            language: "auto".into(),
            window_on_top: false,
            close_action: "quit".into(),
            start_minimized: true,
            theme: "system".into(),
            theme_duration_ms: 250,
            idle_secs: 30,
            starting_secs: 5,
            git_full_mins: 5,
            signal_secs: 3,
            commit_warn_percent: 85,
            commit_critical_percent: 90,
            slot_memory_warn_gb: 10.0,
            local_only_warn_days: 3,
            local_only_critical_days: 14,
            flash_taskbar: true,
            open_target: crate::open::OPEN_TARGETS[0].into(),
            branch_view_open_fork: true,
            unity_slot_script: String::new(),
            sample_file: String::new(),
        }
    }
}

impl WidgetSettings {
    /// Ranges and choices. src/settings.ts has the same numbers (src/settings.test.ts compares them).
    fn clamp(mut self) -> Self {
        self.theme_duration_ms = self.theme_duration_ms.clamp(0, 1000);
        self.idle_secs = self.idle_secs.clamp(10, 600);
        self.starting_secs = self.starting_secs.clamp(2, 60);
        self.git_full_mins = self.git_full_mins.clamp(1, 120);
        self.signal_secs = self.signal_secs.clamp(1, 60);
        self.commit_warn_percent = self.commit_warn_percent.clamp(50, 99);
        self.commit_critical_percent = self.commit_critical_percent.clamp(self.commit_warn_percent, 100);
        self.slot_memory_warn_gb = self.slot_memory_warn_gb.clamp(1.0, 128.0);
        self.local_only_warn_days = self.local_only_warn_days.clamp(0, 365);
        self.local_only_critical_days = self.local_only_critical_days.clamp(0, 365);
        if !matches!(self.language.as_str(), "auto" | "ko" | "en") {
            self.language = "auto".into();
        }
        if !matches!(self.close_action.as_str(), "quit" | "tray") {
            self.close_action = "quit".into();
        }
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = "system".into();
        }
        if !crate::open::OPEN_TARGETS.contains(&self.open_target.as_str()) {
            self.open_target = crate::open::OPEN_TARGETS[0].into();
        }
        self
    }
}

fn file() -> PathBuf {
    paths::slot_home().join("widget.json")
}

pub fn file_path() -> String {
    file().display().to_string()
}

/// True when `value` can stand for `key` (right type); checked one key at a time.
fn fits(key: &str, value: &Value) -> bool {
    let mut one = Map::new();
    one.insert(key.to_string(), value.clone());
    serde_json::from_value::<WidgetSettings>(Value::Object(one)).is_ok()
}

/// Settings from a JSON object: each readable known key over the defaults, then clamped.
fn from_object(obj: &Map<String, Value>) -> WidgetSettings {
    let mut merged = match serde_json::to_value(WidgetSettings::default()) {
        Ok(Value::Object(map)) => map,
        _ => return WidgetSettings::default(),
    };
    for key in KEYS {
        if let Some(value) = obj.get(key).filter(|v| fits(key, v)) {
            merged.insert(key.to_string(), value.clone());
        }
    }
    serde_json::from_value::<WidgetSettings>(Value::Object(merged))
        .unwrap_or_default()
        .clamp()
}

/// The file as an object. `Ok(None)` when it does not exist; an error when it cannot be read or
/// is not a JSON object (then nothing is written over it).
fn read_object(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read:{e}")),
    };
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(map)) => Ok(Some(map)),
        Ok(_) => Err("invalid:not an object".into()),
        Err(e) => Err(format!("invalid:{e}")),
    }
}

fn load_from(path: &Path) -> WidgetSettings {
    match read_object(path) {
        Ok(Some(obj)) => from_object(&obj),
        _ => WidgetSettings::default(),
    }
}

pub fn load() -> WidgetSettings {
    load_from(&file())
}

/// Pretty JSON with the known keys first in [`KEYS`] order, then the others.
fn to_text(obj: &Map<String, Value>) -> String {
    let mut names: Vec<&str> = KEYS.iter().copied().filter(|k| obj.contains_key(*k)).collect();
    names.extend(obj.keys().map(String::as_str).filter(|k| !KEYS.contains(k)));
    let mut out = String::from("{\n");
    for (i, name) in names.iter().enumerate() {
        let value = serde_json::to_string_pretty(&obj[*name]).unwrap_or_else(|_| "null".into());
        let key = serde_json::to_string(name).unwrap_or_default();
        out.push_str(&format!("  {key}: {}", value.replace('\n', "\n  ")));
        out.push_str(if i + 1 < names.len() { ",\n" } else { "\n" });
    }
    out.push_str("}\n");
    out
}

/// Writes through `<file>.tmp` and a rename, so a reader never sees half a file.
fn write_replace(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("write:{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write:{e}"))?;
    let mut last = None;
    // Someone may be reading the file at this moment (an editor, an agent): try a few times
    for _ in 0..5 {
        match std::fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let _ = std::fs::remove_file(&tmp);
    Err(format!("write:{}", last.map(|e| e.to_string()).unwrap_or_default()))
}

/// One writer at a time inside this process.
static WRITE: Mutex<()> = Mutex::new(());

/// Merges `patch` into the file at `path` and returns the settings now in effect.
/// Unknown keys and values of the wrong type in `patch` are skipped; the others are written
/// clamped. Nothing else in the file changes.
fn update_at(path: &Path, patch: &Map<String, Value>) -> Result<WidgetSettings, String> {
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let mut obj = read_object(path)?.unwrap_or_default();
    let mut accepted = Vec::new();
    for (key, value) in patch {
        if KEYS.contains(&key.as_str()) && fits(key, value) {
            obj.insert(key.clone(), value.clone());
            accepted.push(key.clone());
        }
    }
    let settings = from_object(&obj);
    // The changed keys go in as they are in effect (clamped); the rest of the file stays
    if let Ok(Value::Object(clamped)) = serde_json::to_value(&settings) {
        for key in &accepted {
            if let Some(value) = clamped.get(key) {
                obj.insert(key.clone(), value.clone());
            }
        }
    }
    if !accepted.is_empty() {
        write_replace(path, &to_text(&obj))?;
    }
    Ok(settings)
}

pub fn update(patch: &Map<String, Value>) -> Result<WidgetSettings, String> {
    update_at(&file(), patch)
}

// ---------------------------------------------------------------- project nicknames

/// Nicknames the user gave to projects (list groups), by the name the core reports: the
/// `projectAliases` object of widget.json. Not a [`WidgetSettings`] field, because the settings
/// popup lists every field there. The screens show a nickname in place of the name; filters, copied
/// text and core calls keep the real name. Only this key is written; the rest of the file stays.
pub const ALIASES_KEY: &str = "projectAliases";
/// Longest nickname kept, in characters (src/aliases.ts has the same number).
pub const ALIAS_MAX_CHARS: usize = 40;

pub type Aliases = std::collections::BTreeMap<String, String>;

/// A nickname as stored: control characters become spaces, the ends are trimmed, at most
/// [`ALIAS_MAX_CHARS`]. Empty means none.
fn clean_alias(text: &str) -> String {
    let line: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let short: String = line.trim().chars().take(ALIAS_MAX_CHARS).collect();
    short.trim_end().to_string()
}

/// The readable nicknames of a widget.json object; other values under the key are skipped.
fn aliases_from(obj: &Map<String, Value>) -> Aliases {
    let mut out = Aliases::new();
    if let Some(Value::Object(map)) = obj.get(ALIASES_KEY) {
        for (project, value) in map {
            let Value::String(text) = value else { continue };
            let alias = clean_alias(text);
            if !project.is_empty() && !alias.is_empty() && alias != *project {
                out.insert(project.clone(), alias);
            }
        }
    }
    out
}

fn load_aliases_from(path: &Path) -> Aliases {
    match read_object(path) {
        Ok(Some(obj)) => aliases_from(&obj),
        _ => Aliases::new(),
    }
}

pub fn load_aliases() -> Aliases {
    load_aliases_from(&file())
}

/// Sets one project's nickname and returns them all. An empty nickname, or the project's own name,
/// clears it, so the project shows the core's name again. Nicknames of other projects (someone may
/// have edited them meanwhile) stay; the key goes away with the last nickname.
fn set_alias_at(path: &Path, project: &str, alias: &str) -> Result<Aliases, String> {
    if project.is_empty() {
        return Err("project:empty".into());
    }
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let mut obj = read_object(path)?.unwrap_or_default();
    let alias = clean_alias(alias);
    let clear = alias.is_empty() || alias == project;
    let before = obj.get(ALIASES_KEY).cloned();
    // A value that is not an object cannot hold nicknames: the first one replaces it
    let mut map = match obj.get(ALIASES_KEY) {
        Some(Value::Object(map)) => map.clone(),
        _ => Map::new(),
    };
    if clear {
        map.remove(project);
    } else {
        map.insert(project.to_string(), Value::String(alias));
    }
    if map.is_empty() {
        if clear && !matches!(before, Some(Value::Object(_))) {
            // Nothing stored and nothing to store: leave the file alone
            return Ok(aliases_from(&obj));
        }
        obj.remove(ALIASES_KEY);
    } else {
        obj.insert(ALIASES_KEY.to_string(), Value::Object(map));
    }
    if obj.get(ALIASES_KEY).cloned() != before {
        write_replace(path, &to_text(&obj))?;
    }
    Ok(aliases_from(&obj))
}

pub fn set_alias(project: &str, alias: &str) -> Result<Aliases, String> {
    set_alias_at(&file(), project, alias)
}

/// The dashboard sample to read instead of running the core: the setting, else the
/// `UNITY_SLOT_WIDGET_SAMPLE` environment variable (development, screenshots).
pub fn sample_source(s: &WidgetSettings) -> Option<String> {
    let setting = s.sample_file.trim();
    if !setting.is_empty() {
        return Some(setting.to_string());
    }
    std::env::var(SAMPLE_ENV).ok().filter(|v| !v.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test under the system temp folder (no extra crate).
    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("usw-settings-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("widget.json")
    }

    fn patch(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap()
    }

    fn read(path: &Path) -> Map<String, Value> {
        read_object(path).unwrap().unwrap()
    }

    #[test]
    fn keys_list_every_field_once() {
        let Value::Object(map) = serde_json::to_value(WidgetSettings::default()).unwrap() else {
            panic!("not an object");
        };
        let mut fields: Vec<&str> = map.keys().map(String::as_str).collect();
        let mut keys = KEYS.to_vec();
        fields.sort_unstable();
        keys.sort_unstable();
        assert_eq!(fields, keys);
    }

    #[test]
    fn keeps_keys_changed_elsewhere_and_unknown_ones() {
        let path = temp_file("external");
        std::fs::write(
            &path,
            r#"{"alwaysOnTop": true, "idleSecs": 45, "oldBlur": 12.0, "note": {"by": "agent"}}"#,
        )
        .unwrap();
        let saved = update_at(&path, &patch(serde_json::json!({ "theme": "dark" }))).unwrap();
        assert_eq!(saved.theme, "dark");
        assert_eq!(saved.idle_secs, 45);
        let file = read(&path);
        assert_eq!(file["alwaysOnTop"], Value::Bool(true));
        assert_eq!(file["idleSecs"], serde_json::json!(45));
        assert_eq!(file["note"], serde_json::json!({ "by": "agent" }));
        assert_eq!(file["theme"], Value::String("dark".into()));
        assert_eq!(file["oldBlur"], serde_json::json!(12.0));
        // Only the changed key was added; the defaults of the others are not written
        assert!(!file.contains_key("signalSecs"));

        // Someone edits the file between two saves: the next save keeps their value
        let mut edited = read(&path);
        edited.insert("signalSecs".into(), serde_json::json!(9));
        std::fs::write(&path, serde_json::to_string(&edited).unwrap()).unwrap();
        let saved = update_at(&path, &patch(serde_json::json!({ "windowOnTop": true }))).unwrap();
        assert_eq!(saved.signal_secs, 9);
        assert!(saved.window_on_top);
        assert_eq!(read(&path)["signalSecs"], serde_json::json!(9));
    }

    #[test]
    fn clamps_and_skips_bad_values() {
        let path = temp_file("clamp");
        std::fs::write(&path, r#"{"idleSecs": 40, "language": "ko"}"#).unwrap();
        let saved = update_at(
            &path,
            &patch(serde_json::json!({ "idleSecs": 3, "language": 7, "nope": 1, "commitWarnPercent": 95, "commitCriticalPercent": 90 })),
        )
        .unwrap();
        assert_eq!(saved.idle_secs, 10);
        assert_eq!(saved.language, "ko");
        assert_eq!(saved.commit_critical_percent, 95);
        let file = read(&path);
        assert_eq!(file["idleSecs"], serde_json::json!(10));
        assert_eq!(file["language"], Value::String("ko".into()));
        assert!(!file.contains_key("nope"));
    }

    #[test]
    fn a_broken_value_falls_back_alone() {
        let path = temp_file("broken-value");
        std::fs::write(&path, "\u{feff}{\"idleSecs\": \"soon\", \"signalSecs\": 7, \"theme\": \"neon\"}").unwrap();
        let s = load_from(&path);
        assert_eq!(s.idle_secs, 30);
        assert_eq!(s.signal_secs, 7);
        assert_eq!(s.theme, "system");
    }

    #[test]
    fn a_broken_file_is_not_overwritten() {
        let path = temp_file("broken-file");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(update_at(&path, &patch(serde_json::json!({ "theme": "dark" }))).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
        assert_eq!(load_from(&path), WidgetSettings::default());
    }

    #[test]
    fn a_missing_file_gets_only_the_changed_key() {
        let path = temp_file("missing");
        let saved = update_at(&path, &patch(serde_json::json!({ "closeAction": "tray" }))).unwrap();
        assert_eq!(saved.close_action, "tray");
        let file = read(&path);
        assert_eq!(file.len(), 1);
        assert_eq!(file["closeAction"], Value::String("tray".into()));
    }

    #[test]
    fn the_environment_sample_is_never_stored() {
        let path = temp_file("sample");
        std::env::set_var(SAMPLE_ENV, r"C:\samples\dashboard.sample.json");
        let loaded = load_from(&path);
        assert_eq!(loaded.sample_file, "");
        assert_eq!(sample_source(&loaded).as_deref(), Some(r"C:\samples\dashboard.sample.json"));
        // Saving what the app holds (as the old settings window did) writes no sample path
        let Value::Object(all) = serde_json::to_value(&loaded).unwrap() else { panic!() };
        update_at(&path, &all).unwrap();
        assert_eq!(read(&path)["sampleFile"], Value::String(String::new()));
        // The setting wins over the environment
        let mut with_setting = loaded.clone();
        with_setting.sample_file = r" C:\samples\mine.json ".into();
        assert_eq!(sample_source(&with_setting).as_deref(), Some(r"C:\samples\mine.json"));
        std::env::remove_var(SAMPLE_ENV);
        assert_eq!(sample_source(&loaded), None);
    }

    #[test]
    fn a_nickname_is_set_and_an_empty_one_restores_the_name() {
        let path = temp_file("aliases");
        std::fs::write(&path, r#"{"theme": "dark", "projectAliases": {"Other": "다른 것", "Broken": 3}}"#).unwrap();
        let saved = set_alias_at(&path, "VeryLongProjectName", "  본편 \n ").unwrap();
        assert_eq!(saved["VeryLongProjectName"], "본편");
        assert_eq!(saved["Other"], "다른 것");
        assert!(!saved.contains_key("Broken"));
        let file = read(&path);
        assert_eq!(file["theme"], Value::String("dark".into()));
        // Values this build cannot read stay in the file as they are
        assert_eq!(file["projectAliases"]["Broken"], serde_json::json!(3));
        assert_eq!(load_aliases_from(&path), saved);
        assert_eq!(load_from(&path).theme, "dark");

        // Empty, or the name itself: the nickname goes away
        let saved = set_alias_at(&path, "VeryLongProjectName", "   ").unwrap();
        assert!(!saved.contains_key("VeryLongProjectName"));
        set_alias_at(&path, "Other", "Other").unwrap();
        set_alias_at(&path, "Broken", "").unwrap();
        // The last one takes the key with it
        assert!(!read(&path).contains_key("projectAliases"));
        assert_eq!(read(&path)["theme"], Value::String("dark".into()));
    }

    #[test]
    fn a_nickname_is_cut_to_its_limit() {
        let path = temp_file("alias-limit");
        let long = "가".repeat(ALIAS_MAX_CHARS + 5);
        let saved = set_alias_at(&path, "P", &format!("a\tb {long}")).unwrap();
        assert_eq!(saved["P"].chars().count(), ALIAS_MAX_CHARS);
        assert!(saved["P"].starts_with("a b "));
        assert!(set_alias_at(&path, "", "x").is_err());
    }

    #[test]
    fn clearing_a_nickname_writes_nothing_new() {
        let path = temp_file("alias-none");
        assert!(set_alias_at(&path, "P", "").unwrap().is_empty());
        assert!(!path.exists());
        std::fs::write(&path, "{ not json").unwrap();
        assert!(set_alias_at(&path, "P", "별명").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
        assert!(load_aliases_from(&path).is_empty());
    }

    #[test]
    fn written_text_lists_known_keys_first() {
        let mut obj = Map::new();
        obj.insert("zeta".into(), serde_json::json!({ "a": [1, 2] }));
        obj.insert("idleSecs".into(), serde_json::json!(30));
        obj.insert("language".into(), serde_json::json!("en"));
        let text = to_text(&obj);
        let language = text.find("\"language\"").unwrap();
        let idle = text.find("\"idleSecs\"").unwrap();
        let zeta = text.find("\"zeta\"").unwrap();
        assert!(language < idle && idle < zeta);
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), Value::Object(obj));
    }
}
