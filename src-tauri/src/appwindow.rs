//! The main window: an ordinary window (taskbar button, no OS frame; the page draws the title bar).
//! It is transparent without an OS shadow (tauri.conf.json): the page draws an opaque card with
//! rounded corners and its own shadow inside a small margin (src/shell/frame.css), square and
//! without the margin while maximized. It is made hidden (`visible: false`) and shown once the page
//! has painted, so an empty WebView2 page never shows. Started by Windows with 「Start minimized」
//! on, it shows minimized.
//!
//! Position, size and maximized state live in a new window-state file. The widget kept only its
//! position in the old file (with a 0x0 size, because it sized its height to the content), so on
//! the first start the old x and y are taken over when that point is still on a monitor.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::settings;

pub const MAIN_LABEL: &str = "main";
/// The window-state plugin's file (in the app config folder).
pub const STATE_FILE: &str = ".window-state.main.json";
const OLD_STATE_FILE: &str = ".window-state.json";

pub struct Startup {
    shown: AtomicBool,
    from_autostart: bool,
}

impl Startup {
    pub fn from_args() -> Self {
        Self {
            shown: AtomicBool::new(false),
            // install.rs registers the exe with this flag in the Run key
            from_autostart: std::env::args().any(|a| a == "--from-autostart"),
        }
    }
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_LABEL)
}

/// The main window has been shown once (by the page's first paint, the fallback timer, the tray).
pub fn was_shown(app: &AppHandle) -> bool {
    app.state::<Startup>().shown.load(Ordering::SeqCst)
}

/// The window was shown another way (tray, a second start): the first-show path does nothing more.
pub fn mark_shown(app: &AppHandle) {
    app.state::<Startup>().shown.store(true, Ordering::SeqCst);
}

/// Shows the window the first time: after the page's first paint (`window_ready`), or from the
/// fallback timer if the page never says so. Later calls do nothing.
pub fn show_first(app: &AppHandle) {
    let startup = app.state::<Startup>();
    if startup.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(window) = main_window(app) else {
        return;
    };
    if startup.from_autostart && settings::load().start_minimized {
        // Minimized while still hidden, then shown: it appears on the taskbar only
        let _ = window.minimize();
        let _ = window.show();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// What the Rust side does with the settings: the window pin, the quick-signal interval and, with
/// the close box set to the small widget, its window made ahead. At start, after a save from the
/// page, and when widget.json was changed by someone else (signals.rs), so a pin set in the file by
/// a person or an agent applies too.
pub fn apply_settings(app: &AppHandle, s: &settings::WidgetSettings) {
    crate::signals::set_interval(s.signal_secs);
    if let Some(window) = main_window(app) {
        let _ = window.set_always_on_top(s.window_on_top);
    }
    crate::mini::prepare(app, s);
}

/// x and y of the main window in the old window-state file.
fn old_position(text: &str) -> Option<(i32, i32)> {
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let main = value.get(MAIN_LABEL)?;
    let x = i32::try_from(main.get("x")?.as_i64()?).ok()?;
    let y = i32::try_from(main.get("y")?.as_i64()?).ok()?;
    Some((x, y))
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Where a window of `width` x `height` goes when its top-left corner was at (x, y): on the
/// monitor area holding that point, moved in so it fits (the window is bigger than the widget
/// was). None when the point is on no monitor (unplugged): the window stays centered.
fn place(x: i32, y: i32, width: u32, height: u32, areas: &[Area]) -> Option<(i32, i32)> {
    let area = areas
        .iter()
        .find(|a| x >= a.x && x < a.x + a.width as i32 && y >= a.y && y < a.y + a.height as i32)?;
    let right = area.x + area.width as i32;
    let bottom = area.y + area.height as i32;
    Some((x.min(right - width as i32).max(area.x), y.min(bottom - height as i32).max(area.y)))
}

/// First start with the new state file: take the old widget's x and y (see the module comment).
pub fn import_old_position(app: &AppHandle, window: &WebviewWindow) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    if dir.join(STATE_FILE).exists() {
        return;
    }
    let Some((x, y)) = std::fs::read_to_string(dir.join(OLD_STATE_FILE))
        .ok()
        .and_then(|text| old_position(&text))
    else {
        return;
    };
    let (Ok(size), Ok(monitors)) = (window.outer_size(), window.available_monitors()) else {
        return;
    };
    let areas: Vec<Area> = monitors
        .iter()
        .map(|m| {
            let work = m.work_area();
            Area { x: work.position.x, y: work.position.y, width: work.size.width, height: work.size.height }
        })
        .collect();
    if let Some((x, y)) = place(x, y, size.width, size.height, &areas) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_old_widget_position() {
        let old = r#"{"main":{"width":0,"height":0,"x":-2543,"y":666,"prev_x":-2543,"prev_y":667,"maximized":false,"visible":true,"decorated":true,"fullscreen":false}}"#;
        assert_eq!(old_position(old), Some((-2543, 666)));
        assert_eq!(old_position(r#"{"settings":{"x":1,"y":2}}"#), None);
        assert_eq!(old_position("not json"), None);
    }

    #[test]
    fn places_the_bigger_window_on_the_same_monitor() {
        let left = Area { x: -2560, y: 0, width: 2560, height: 1400 };
        let main = Area { x: 0, y: 0, width: 1920, height: 1040 };
        let areas = [left, main];
        // Fits as it is
        assert_eq!(place(-2543, 166, 1200, 760, &areas), Some((-2543, 166)));
        // Would run past the bottom and the right edge: moved in, still on that monitor
        assert_eq!(place(-2543, 666, 1200, 760, &areas), Some((-2543, 640)));
        assert_eq!(place(1500, 100, 1200, 760, &areas), Some((720, 100)));
        // On no monitor any more
        assert_eq!(place(5000, 100, 1200, 760, &areas), None);
    }
}
