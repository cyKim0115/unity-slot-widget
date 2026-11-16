mod core;
mod install;
mod open;
mod paths;
mod settings;
mod signals;
mod tray;

use settings::WidgetSettings;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

const MAIN_LABEL: &str = "main";
const SETTINGS_LABEL: &str = "settings";

#[tauri::command]
fn get_settings() -> WidgetSettings {
    settings::load()
}

/// Stores only the keys in `patch` (merged into widget.json, which others edit too) and returns the
/// settings now in effect. The window pin and the signal interval follow at once.
#[tauri::command]
fn update_settings(app: tauri::AppHandle, patch: serde_json::Map<String, serde_json::Value>) -> Result<WidgetSettings, String> {
    let saved = settings::update(&patch)?;
    apply_saved(&app, &saved);
    Ok(saved)
}

/// The old settings window sends everything it holds; only the changed keys reach the file.
#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: WidgetSettings) -> Result<WidgetSettings, String> {
    let current = serde_json::to_value(settings::load()).map_err(|e| e.to_string())?;
    let next = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
    let mut patch = serde_json::Map::new();
    if let (serde_json::Value::Object(current), serde_json::Value::Object(next)) = (current, next) {
        for (key, value) in next {
            if current.get(&key) != Some(&value) {
                patch.insert(key, value);
            }
        }
    }
    let saved = settings::update(&patch)?;
    apply_saved(&app, &saved);
    app.emit("settings-saved", saved.clone()).map_err(|e| e.to_string())?;
    Ok(saved)
}

fn apply_saved(app: &tauri::AppHandle, saved: &WidgetSettings) {
    signals::set_interval(saved.signal_secs);
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.set_always_on_top(saved.window_on_top);
    }
}

#[tauri::command]
fn get_core_location() -> paths::CoreLocation {
    paths::locate_core(&settings::load().unity_slot_script)
}

/// `git`: `basic` (status of each slot clone) or `full` (also local-only commits, branches,
/// stash, worktrees). Runs on a blocking thread so the window stays responsive.
#[tauri::command]
async fn get_dashboard(git: String) -> Result<core::DashboardResult, String> {
    let s = settings::load();
    let sample = settings::sample_source(&s);
    tauri::async_runtime::spawn_blocking(move || core::dashboard(&git, &s.unity_slot_script, sample))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    open::open_folder(&path)
}

#[tauri::command]
fn open_log(path: String) -> Result<(), String> {
    open::open_log(&path)
}

/// A slot card's right-click > Open: the folder in Fork, a terminal, an editor or Explorer.
#[tauri::command]
fn open_with(path: String, target: String) -> Result<(), String> {
    open::open_with(&path, &target)
}

/// A slot card's right-click > Open in Unity: `unity-slot open <slot path> -NoWait` through the core.
#[tauri::command]
async fn open_in_unity(path: String) -> Result<core::OpenResult, String> {
    let s = settings::load();
    tauri::async_runtime::spawn_blocking(move || core::open_slot(&s.unity_slot_script, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// A slot card's right-click > Show Unity window, for an editor that is already open.
#[tauri::command]
fn focus_editor(pid: u32) -> Result<(), String> {
    open::focus_window(pid)
}

#[tauri::command]
fn set_tray_labels(app: tauri::AppHandle, labels: tray::TrayLabels) -> Result<(), String> {
    tray::set_labels(&app, &labels)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(SETTINGS_LABEL)
        .ok_or_else(|| "settings window not found".to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.emit("settings-open", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn is_dev_build() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
fn enable_autostart() -> Result<(), String> {
    install::enable()
}

#[tauri::command]
fn disable_autostart() -> Result<(), String> {
    install::disable()
}

#[tauri::command]
fn is_autostart_enabled() -> Result<bool, String> {
    install::is_enabled()
}

/// The page measures its content and asks for that height (CSS px).
#[tauri::command]
fn resize_main_window(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    // A resizable window without decorations still has a thin frame outside the page.
    let frame = outer.height.saturating_sub(inner.height);
    let height = (height.clamp(140.0, 900.0) * scale).round() as u32 + frame;
    if outer.height != height {
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize { width: outer.width, height }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Position only: the page sets the height from its content on every refresh.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&[SETTINGS_LABEL])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            save_settings,
            get_core_location,
            get_dashboard,
            open_folder,
            open_log,
            open_with,
            open_in_unity,
            focus_editor,
            set_tray_labels,
            quit_app,
            open_settings_window,
            close_settings_window,
            is_dev_build,
            enable_autostart,
            disable_autostart,
            is_autostart_enabled,
            resize_main_window,
            set_always_on_top
        ])
        .setup(|app| {
            tray::install(app)?;
            install::cleanup_debug_entry();
            let s = settings::load();
            if let Some(window) = app.get_webview_window(MAIN_LABEL) {
                let _ = window.set_always_on_top(s.window_on_top);
            }
            signals::set_interval(s.signal_secs);
            signals::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == SETTINGS_LABEL {
                    // The close box is the same as Cancel; the window is reused.
                    api.prevent_close();
                    let _ = window.emit("settings-cancelled", ());
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
