//! Notification-area icon.
//!
//! The widget has no taskbar button, so the tray is where a hidden widget comes back.
//! Left click shows or hides it; right click opens the menu. The page sends the menu labels in
//! its language (`set_tray_labels`); until then they are English.

use tauri::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const MAIN_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const MENU_SHOW: &str = "tray-show";
const MENU_HIDE: &str = "tray-hide";
const MENU_SETTINGS: &str = "tray-settings";
const MENU_QUIT: &str = "tray-quit";

#[derive(Clone, Debug, serde::Deserialize)]
pub struct TrayLabels {
    pub show: String,
    pub hide: String,
    pub settings: String,
    pub quit: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        Self {
            show: "Show widget".into(),
            hide: "Hide widget".into(),
            settings: "Settings".into(),
            quit: "Quit".into(),
        }
    }
}

fn build_menu<R: Runtime, M: Manager<R>>(manager: &M, labels: &TrayLabels) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(manager, MENU_SHOW, &labels.show, true, None::<&str>)?;
    let hide = MenuItem::with_id(manager, MENU_HIDE, &labels.hide, true, None::<&str>)?;
    let settings = MenuItem::with_id(manager, MENU_SETTINGS, &labels.settings, true, None::<&str>)?;
    let quit = MenuItem::with_id(manager, MENU_QUIT, &labels.quit, true, None::<&str>)?;
    Menu::with_items(
        manager,
        &[
            &show,
            &hide,
            &PredefinedMenuItem::separator(manager)?,
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

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SHOW => show_widget(app),
        MENU_HIDE => hide_widget(app),
        MENU_SETTINGS => {
            let _ = super::open_settings_window(app.clone());
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
        let visible = app
            .get_webview_window(MAIN_LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if visible {
            hide_widget(app);
        } else {
            show_widget(app);
        }
    }
}

pub fn show_widget(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    // tao clears the taskbar button only when it creates the window; clear it again.
    let _ = window.set_skip_taskbar(true);
}

fn hide_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
    }
}
