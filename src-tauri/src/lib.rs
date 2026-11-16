mod appwindow;
mod core;
mod install;
mod open;
mod overlay;
mod paths;
mod settings;
mod signals;
mod tray;

use appwindow::MAIN_LABEL;
use settings::WidgetSettings;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

#[tauri::command]
fn get_settings() -> WidgetSettings {
    settings::load()
}

/// Stores only the keys in `patch` (merged into widget.json, which others edit too) and returns the
/// settings now in effect. The window pin, the background color and the signal interval follow at once.
#[tauri::command]
fn update_settings(app: tauri::AppHandle, patch: serde_json::Map<String, serde_json::Value>) -> Result<WidgetSettings, String> {
    let saved = settings::update(&patch)?;
    appwindow::apply_settings(&app, &saved);
    Ok(saved)
}

/// The page has painted once: show the window (minimized when Windows started it and the
/// setting says so). Later calls (a page reload) do nothing.
#[tauri::command]
fn window_ready(app: tauri::AppHandle) {
    appwindow::show_first(&app);
}

/// What the settings About tab shows.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    settings_file: String,
    slot_home: String,
    dev: bool,
}

#[tauri::command]
fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        settings_file: settings::file_path(),
        slot_home: paths::slot_home().display().to_string(),
        dev: cfg!(debug_assertions),
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

/// The view repository of a project (core 0.7.0 `branch-view`): a plan without `apply`, else make or
/// refresh it. Only a person's press calls this. While sample data is shown it does nothing (the
/// sample's projects are not this PC's). A run that outlasts the time limit is not killed; its result
/// comes later as the event `branch-view-finished` ({ project, apply, result | error }).
#[tauri::command]
async fn branch_view(app: tauri::AppHandle, project: String, apply: bool) -> Result<core::BranchViewResult, String> {
    let s = settings::load();
    if settings::sample_source(&s).is_some() {
        return Err("sample".into());
    }
    let late_project = project.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core::branch_view(&s.unity_slot_script, &project, apply, move |outcome| {
            let payload = match outcome {
                Ok(result) => serde_json::json!({ "project": late_project, "apply": apply, "result": result }),
                Err(error) => serde_json::json!({ "project": late_project, "apply": apply, "error": error }),
            };
            let _ = app.emit_to(MAIN_LABEL, "branch-view-finished", payload);
        })
    })
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

/// At a glance while the window is out of sight: the tray tooltip (`status` under the app name),
/// the taskbar badge for `level` (critical | warn | ok | none) and, for a new risk, a taskbar flash.
#[tauri::command]
fn set_glance(app: tauri::AppHandle, status: String, level: String, attention: bool) {
    tray::set_tooltip(&app, &overlay::tooltip_text(&app.package_info().name, &status));
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        overlay::set_badge(&window, &level);
        if attention {
            overlay::flash(&window);
        }
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // A second start shows the running window instead. Release builds only: the lock is the app
    // identifier, so an installed copy that is running would quietly end `tauri dev`.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_widget(app)));
    builder
        // Position, size and maximized state, in a file of its own (see appwindow.rs)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename(appwindow::STATE_FILE)
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(appwindow::Startup::from_args())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            get_app_info,
            get_core_location,
            get_dashboard,
            open_folder,
            open_log,
            open_with,
            open_in_unity,
            branch_view,
            focus_editor,
            set_tray_labels,
            set_glance,
            quit_app,
            enable_autostart,
            disable_autostart,
            is_autostart_enabled,
            window_ready
        ])
        .setup(|app| {
            tray::install(app)?;
            install::cleanup_debug_entry();
            if let Some(window) = app.get_webview_window(MAIN_LABEL) {
                appwindow::import_old_position(app.handle(), &window);
            }
            appwindow::apply_settings(app.handle(), &settings::load());
            signals::start(app.handle().clone());
            // The page normally asks for the first show; if it never does, show the window anyway
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                appwindow::show_first(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_LABEL {
                return;
            }
            match event {
                // The close box quits, or hides to the tray when the setting says so
                WindowEvent::CloseRequested { api, .. } if settings::load().close_action == "tray" => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::ThemeChanged(_) => {
                    if let Some(window) = window.app_handle().get_webview_window(MAIN_LABEL) {
                        appwindow::paint_background(&window, &settings::load().theme);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
