//! The small widget: what the close box leaves on screen when it is set to 「작은 위젯으로」
//! (`closeAction: "widget"`). The main window hides and a small window without a frame or a
//! taskbar button lists only the slots whose editor is open (src/mini/). It shows itself when an
//! editor opens and hides when the last one closes, without taking the focus from the window the
//! person is working in. A press on it brings the main window back and ends the mode; so do the
//! tray icon and a second start of the app.
//!
//! The page refreshes and draws, then reports the height it needs (`mini_layout`); this side sizes,
//! places and shows or hides the window. A window in the lower half of its monitor keeps its bottom
//! edge when it grows or shrinks (by default it sits in the bottom-right corner, above the
//! taskbar), one in the upper half keeps its top edge. The window is made the first time the mode
//! starts and kept, hidden, after it ends. The window-state plugin keeps its position.
//!
//! Showing and hiding go through Win32 directly: tao's `show` activates the window, and a widget
//! that pops up while the person types elsewhere must not take the keyboard.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    IsWindowVisible, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE,
};

use crate::{appwindow, settings};

pub const MINI_LABEL: &str = "mini";
/// Width in logical pixels (src/mini/mini.css draws to the window's width).
const WIDTH: f64 = 288.0;
/// Height before the page has measured itself.
const FIRST_HEIGHT: f64 = 64.0;
/// Gap to the work area's edges in the default corner, logical pixels.
const MARGIN: f64 = 12.0;

/// The mode is on: the main window was closed to the widget.
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// The window is being made (on a thread of its own).
static CREATING: AtomicBool = AtomicBool::new(false);

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

pub fn mini_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MINI_LABEL)
}

/// The main window goes out of sight and the widget takes over. The widget shows once its page has
/// drawn an open editor.
pub fn enter(app: &AppHandle) {
    if let Some(main) = appwindow::main_window(app) {
        let _ = main.hide();
    }
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    if mini_window(app).is_some() {
        let _ = app.emit_to(MINI_LABEL, "mini-mode", true);
        return;
    }
    if CREATING.swap(true, Ordering::SeqCst) {
        return;
    }
    // Not on the event loop's thread: building a webview there can wait on itself
    let app = app.clone();
    std::thread::spawn(move || {
        let made = create(&app);
        CREATING.store(false, Ordering::SeqCst);
        if let Err(error) = made {
            eprintln!("mini widget: {error}");
            // Without a widget the app would be out of sight: bring the main window back
            crate::tray::show_widget(&app);
        }
    });
}

/// The main window is back: the widget hides and its page stops refreshing.
pub fn leave(app: &AppHandle) {
    if !ACTIVE.swap(false, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = mini_window(app) {
        hide(app, window);
    }
    let _ = app.emit_to(MINI_LABEL, "mini-mode", false);
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let saved = has_saved_state(app);
    let window = WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::App("mini.html".into()))
        .title(app.package_info().name.clone())
        .inner_size(WIDTH, FIRST_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;
    appwindow::paint_background(&window, &settings::load().theme);
    // The window-state plugin put it where it was last time; the first time, the corner
    if !saved {
        place_in_corner(app, &window);
    }
    Ok(())
}

/// The window-state file already has this window (then the plugin restores its position).
fn has_saved_state(app: &AppHandle) -> bool {
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(dir.join(appwindow::STATE_FILE)) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}'))
        .ok()
        .and_then(|v| v.get(MINI_LABEL)?.get("width")?.as_u64())
        .is_some_and(|width| width > 0)
}

/// Bottom-right corner of the work area the main window is on (else the primary monitor's).
fn place_in_corner(app: &AppHandle, window: &WebviewWindow) {
    let monitor = appwindow::main_window(app)
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) else {
        return;
    };
    let work = monitor.work_area();
    let area = Rect {
        x: work.position.x,
        y: work.position.y,
        w: work.size.width as i32,
        h: work.size.height as i32,
    };
    let scale = monitor.scale_factor();
    let margin = (MARGIN * scale).round() as i32;
    // The width the layout gives it (the frame may still count invisible borders now)
    let width = (WIDTH * scale).round() as i32;
    let (x, y) = corner(area, width, size.height as i32, margin);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn corner(work: Rect, w: i32, h: i32, margin: i32) -> (i32, i32) {
    (
        (work.x + work.w - w - margin).max(work.x),
        (work.y + work.h - h - margin).max(work.y),
    )
}

/// Where the window goes when its content needs `w` x `h`: the bottom edge stays when the window is
/// in the lower half of the work area, else the top edge; then it is moved inside the work area.
/// Returns the rectangle and whether the bottom edge is the one kept.
fn fit(now: Rect, w: i32, h: i32, work: Rect) -> (Rect, bool) {
    let bottom = now.y + now.h / 2 > work.y + work.h / 2;
    let h = h.min(work.h).max(1);
    let y = if bottom { now.y + now.h - h } else { now.y };
    let x = now.x.clamp(work.x, (work.x + work.w - w).max(work.x));
    let y = y.clamp(work.y, (work.y + work.h - h).max(work.y));
    (Rect { x, y, w, h }, bottom)
}

/// The window's handle in this crate's `windows` version (tauri may use another one).
fn handle(window: &WebviewWindow) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0 as _))
}

fn hide(app: &AppHandle, window: WebviewWindow) {
    let _ = app.run_on_main_thread(move || {
        if let Some(hwnd) = handle(&window) {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    });
}

/// What the page learns from a layout: whether the window is on screen and which edge it keeps
/// (the page lines its rows up against that edge while they come and go).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    shown: bool,
    anchor: &'static str,
}

/// The page needs `height` logical pixels (0: nothing to show). Sizes and places the window and
/// shows it without activating it, or hides it.
#[tauri::command]
pub fn mini_layout(app: AppHandle, height: f64) -> Placement {
    let Some(window) = mini_window(&app) else {
        return Placement { shown: false, anchor: "bottom" };
    };
    if !is_active() || !height.is_finite() || height < 1.0 {
        hide(&app, window);
        return Placement { shown: false, anchor: "bottom" };
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return Placement { shown: false, anchor: "bottom" };
    };
    let now = Rect { x: pos.x, y: pos.y, w: size.width as i32, h: size.height as i32 };
    let work = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let a = m.work_area();
            Rect { x: a.position.x, y: a.position.y, w: a.size.width as i32, h: a.size.height as i32 }
        })
        .unwrap_or(now);
    let w = (WIDTH * scale).round() as i32;
    let h = (height * scale).ceil() as i32;
    let (target, bottom) = fit(now, w, h, work);
    let _ = app.run_on_main_thread(move || {
        // The mode may have ended while this waited
        if !is_active() {
            return;
        }
        let Some(hwnd) = handle(&window) else {
            return;
        };
        unsafe {
            let _ = SetWindowPos(hwnd, None, target.x, target.y, target.w, target.h, SWP_NOZORDER | SWP_NOACTIVATE);
            if !IsWindowVisible(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    });
    Placement { shown: true, anchor: if bottom { "bottom" } else { "top" } }
}

/// The page asks once it has loaded (the window may be made after the mode began).
#[tauri::command]
pub fn mini_active() -> bool {
    is_active()
}

/// A press on the widget: the main window comes back (ending the mode), with `slot` selected.
#[tauri::command]
pub fn mini_open_main(app: AppHandle, slot: Option<String>) {
    crate::tray::show_widget(&app);
    if let Some(slot) = slot.filter(|s| !s.is_empty()) {
        let _ = app.emit_to(appwindow::MAIN_LABEL, "select-slot", slot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { x: 0, y: 0, w: 1920, h: 1040 };

    #[test]
    fn the_corner_is_above_the_taskbar_on_the_right() {
        assert_eq!(corner(WORK, 288, 64, 12), (1620, 964));
        let left = Rect { x: -2560, y: 0, w: 2560, h: 1400 };
        assert_eq!(corner(left, 288, 64, 12), (-300, 1324));
    }

    #[test]
    fn a_low_window_keeps_its_bottom_edge() {
        let now = Rect { x: 1620, y: 964, w: 288, h: 64 };
        let (r, bottom) = fit(now, 288, 120, WORK);
        assert!(bottom);
        assert_eq!(r, Rect { x: 1620, y: 908, w: 288, h: 120 });
        // and shrinks back to the same bottom
        let (r, _) = fit(r, 288, 64, WORK);
        assert_eq!(r.y + r.h, 1028);
    }

    #[test]
    fn a_high_window_keeps_its_top_edge() {
        let now = Rect { x: 100, y: 40, w: 288, h: 64 };
        let (r, bottom) = fit(now, 288, 200, WORK);
        assert!(!bottom);
        assert_eq!(r, Rect { x: 100, y: 40, w: 288, h: 200 });
    }

    #[test]
    fn the_window_stays_inside_the_work_area() {
        // Grown past the top: moved down
        let (r, _) = fit(Rect { x: 1620, y: 900, w: 288, h: 100 }, 288, 1200, WORK);
        assert_eq!((r.y, r.h), (0, 1040));
        // Dragged half off the right edge: moved in
        let (r, _) = fit(Rect { x: 1800, y: 40, w: 288, h: 64 }, 288, 64, WORK);
        assert_eq!(r.x, 1632);
    }
}
