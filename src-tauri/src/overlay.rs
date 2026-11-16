//! At a glance while the window is out of sight: the taskbar overlay icon (a small badge on the
//! taskbar button), the tray tooltip and a taskbar flash for a new risk. The page decides the
//! level and the text (src/glance.ts) and sends them with `set_glance` when they change.
//!
//! The badges are drawn here (32x32, Windows scales them to the small icon size): a red disc with
//! "!" for critical, an amber disc with "!" for attention, a green disc for all right.

use std::sync::Mutex;

use tauri::image::Image;
use tauri::{UserAttentionType, WebviewWindow};

const SIZE: u32 = 32;
const RED: [u8; 3] = [0xd1, 0x34, 0x38];
const AMBER: [u8; 3] = [0xe0, 0xa0, 0x00];
const GREEN: [u8; 3] = [0x2f, 0x8f, 0x4e];
const WHITE: [u8; 3] = [0xff, 0xff, 0xff];
const INK: [u8; 3] = [0x1b, 0x1b, 0x1b];

/// critical | warn | ok; anything else (no answer yet): no badge.
fn colors(level: &str) -> Option<([u8; 3], Option<[u8; 3]>)> {
    match level {
        "critical" => Some((RED, Some(WHITE))),
        "warn" => Some((AMBER, Some(INK))),
        "ok" => Some((GREEN, None)),
        _ => None,
    }
}

/// "!" in the middle: a bar and a dot, 4 px wide.
fn in_mark(x: u32, y: u32) -> bool {
    (14..18).contains(&x) && ((7..19).contains(&y) || (21..25).contains(&y))
}

/// RGBA pixels of the badge: a disc with a white rim (it sits on the app icon) and the mark.
fn badge(fill: [u8; 3], mark: Option<[u8; 3]>) -> Vec<u8> {
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let center = (SIZE as f32 - 1.0) / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let d = ((x as f32 - center).powi(2) + (y as f32 - center).powi(2)).sqrt();
            // Coverage with a soft edge one pixel wide
            let outer = (15.5 - d + 0.5).clamp(0.0, 1.0);
            if outer <= 0.0 {
                continue;
            }
            let inner = (13.5 - d + 0.5).clamp(0.0, 1.0);
            let base = match mark {
                Some(color) if in_mark(x, y) => color,
                _ => fill,
            };
            let mut px = [0u8; 4];
            for c in 0..3 {
                px[c] = (WHITE[c] as f32 * (1.0 - inner) + base[c] as f32 * inner).round() as u8;
            }
            px[3] = (outer * 255.0).round() as u8;
            let i = ((y * SIZE + x) * 4) as usize;
            rgba[i..i + 4].copy_from_slice(&px);
        }
    }
    rgba
}

/// The level the page asked for last, and the one set on the taskbar button now.
struct Badge {
    wanted: String,
    shown: String,
}

static BADGE: Mutex<Badge> = Mutex::new(Badge { wanted: String::new(), shown: String::new() });

fn apply(window: &WebviewWindow, badge_state: &mut Badge) {
    let level = badge_state.wanted.clone();
    let result = match colors(&level) {
        Some((fill, mark)) => window.set_overlay_icon(Some(Image::new_owned(badge(fill, mark), SIZE, SIZE))),
        None => window.set_overlay_icon(None),
    };
    if result.is_ok() {
        badge_state.shown = level;
    }
}

/// Sets the taskbar badge for `level` (once per change).
pub fn set_badge(window: &WebviewWindow, level: &str) {
    let mut state = BADGE.lock().unwrap_or_else(|e| e.into_inner());
    state.wanted = level.to_string();
    if state.shown == level {
        return;
    }
    apply(window, &mut state);
}

/// Sets the last badge again. A window hidden to the tray loses its taskbar button, and the
/// button made when it shows again has no badge: signals.rs calls this a tick after it is back.
pub fn reapply(window: &WebviewWindow) {
    let mut state = BADGE.lock().unwrap_or_else(|e| e.into_inner());
    if state.wanted.is_empty() {
        return;
    }
    apply(window, &mut state);
}

/// Flashes the taskbar button until the window comes to the front; nothing when it is in front.
pub fn flash(window: &WebviewWindow) {
    if window.is_focused().unwrap_or(false) {
        return;
    }
    let _ = window.request_user_attention(Some(UserAttentionType::Informational));
}

/// The tray tooltip: the app name, then the status line. Windows keeps 127 characters.
pub fn tooltip_text(name: &str, status: &str) -> String {
    let text = if status.trim().is_empty() { name.to_string() } else { format!("{name}\n{}", status.trim()) };
    text.chars().take(127).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], x: u32, y: u32) -> [u8; 4] {
        let i = ((y * SIZE + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn draws_a_disc_with_a_mark() {
        let (fill, mark) = colors("critical").unwrap();
        let rgba = badge(fill, mark);
        assert_eq!(rgba.len(), (SIZE * SIZE * 4) as usize);
        assert_eq!(pixel(&rgba, 0, 0)[3], 0, "corner is clear");
        assert_eq!(pixel(&rgba, 15, 10), [0xff, 0xff, 0xff, 0xff], "the bar of the mark");
        assert_eq!(pixel(&rgba, 8, 15), [RED[0], RED[1], RED[2], 0xff], "the disc");
        assert_eq!(&pixel(&rgba, 15, 0)[..3], &WHITE, "the rim");
        let ok = badge(GREEN, None);
        assert_eq!(pixel(&ok, 15, 10), [GREEN[0], GREEN[1], GREEN[2], 0xff], "no mark when all is right");
        assert!(colors("none").is_none());
    }

    #[test]
    fn tooltip_keeps_the_name_first_and_fits() {
        assert_eq!(tooltip_text("App", "editors 5/6 · stalled 1"), "App\neditors 5/6 · stalled 1");
        assert_eq!(tooltip_text("App", "  "), "App");
        let long = "가".repeat(300);
        assert_eq!(tooltip_text("App", &long).chars().count(), 127);
    }
}
