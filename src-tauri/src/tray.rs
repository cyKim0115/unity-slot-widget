//! Notification-area icon.
//!
//! The tray is where a window hidden to the tray (or standing in the small widget, mini.rs) comes
//! back. Left click shows the window when it is hidden or minimized and hides it otherwise (into the
//! small widget when the close box is set to it); right click opens the menu (show the window,
//! settings, quit). The page sends the menu labels in its
//! language (`set_tray_labels`); until then they are English.

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

const MAIN_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const MENU_SHOW: &str = "tray-show";
const MENU_SETTINGS: &str = "tray-settings";
const MENU_QUIT: &str = "tray-quit";

#[derive(Clone, Debug, serde::Deserialize)]
pub struct TrayLabels {
    pub show: String,
    pub settings: String,
    pub quit: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            show: "Show window".into(),
            settings: "Settings".into(),
            quit: "Quit".into(),
        }
    }
}

fn build_menu<R: Runtime, M: Manager<R>>(manager: &M, labels: &TrayLabels) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(manager, MENU_SHOW, &labels.show, true, None::<&str>)?;
    let settings = MenuItem::with_id(manager, MENU_SETTINGS, &labels.settings, true, None::<&str>)?;
    let quit = MenuItem::with_id(manager, MENU_QUIT, &labels.quit, true, None::<&str>)?;
    Menu::with_items(
        manager,
        &[
            &show,
            &settings,
            &PredefinedMenuItem::separator(manager)?,
            &quit,
        ],
    )
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let menu = build_menu(app, &TrayLabels::default())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(&app.package_info().name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_icon_event);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn set_labels(app: &AppHandle, labels: &TrayLabels) -> Result<(), String> {
    let menu = build_menu(app, labels).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SHOW => show_widget(app),
        MENU_SETTINGS => {
            // The settings popup lives in the main window
            show_widget(app);
            let _ = app.emit_to(MAIN_LABEL, "open-settings", ());
        }
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn on_tray_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        let Some(window) = app.get_webview_window(MAIN_LABEL) else {
            return;
        };
        // A minimized window still counts as visible (IsWindowVisible): bring it back too
        let visible = window.is_visible().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);
        if !visible || minimized {
            show_widget(app);
        } else {
            hide_widget(app);
        }
    }
}

/// Shows the window (also from a second start of the app): visible, restored, in front. The small
/// widget, if it was standing in for the window, goes.
pub fn show_widget(app: &AppHandle) {
    crate::mini::leave(app);
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    crate::appwindow::mark_shown(app);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Out of sight the way the close box would put it: to the tray, or into the small widget when the
/// close box is set to it.
fn hide_widget(app: &AppHandle) {
    if crate::settings::load().close_action == "widget" {
        crate::mini::enter(app);
    } else if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
    }
}
