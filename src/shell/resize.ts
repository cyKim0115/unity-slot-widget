/**
 * Width of the details column (#body-main), dragged at its left edge (#body-resizer) or with ←/→
 * on the focused handle; a double click restores the default. Dragged narrower than half the
 * minimum, the column folds (Ctrl+\ opens it again). Adapted from https://github.com/cyKim0115/Frond/
 * @99d89bc, MIT, same author (src/resize.ts, which sizes Frond's table of contents on the left;
 * here the list takes the free width and the details column on the right is the sized one, and
 * the handle reports aria-valuemin/max).
 *
 * The width flows through `--body-w` on #app and is kept in localStorage.
 */

import { isNumber, readPref, writePref } from "./prefs";

export const BODY_DEFAULT_W = 420;
export const BODY_MIN_W = 300;
/** At most this share of the width the list and the details column split; the rest is the list's. */
const BODY_MAX_RATIO = 0.6;
const KEY_STEP = 16;

export function bodyMaxWidth(room: number): number {
  return Math.max(BODY_MIN_W, Math.floor(room * BODY_MAX_RATIO));
}

/**
 * The width to use for a dragged width `raw`, or null to fold the column.
 * `room` is the width the list and the details column share (window minus the side panel).
 */
export function resolveBodyWidth(raw: number, room: number): number | null {
  if (raw < BODY_MIN_W / 2) return null;
  return Math.min(bodyMaxWidth(room), Math.max(BODY_MIN_W, raw));
}

export interface BodyResizeHooks {
  /** Dragged below the fold point: hide the column (the caller owns the open state). */
  fold(): void;
}

export function initBodyResize(hooks: BodyResizeHooks): void {
  const app = document.querySelector<HTMLElement>("#app")!;
  const body = document.querySelector<HTMLElement>("#body-main")!;
  const nav = document.querySelector<HTMLElement>("#nav")!;
  const handle = document.querySelector<HTMLElement>("#body-resizer")!;

  const room = (): number => app.clientWidth - (getComputedStyle(nav).position === "absolute" ? 0 : nav.getBoundingClientRect().width);

  const setWidth = (px: number): void => {
    // A negative value is invalid CSS and jumps to auto: keep it at 0, CSS min-width does the rest
    const width = Math.max(0, Math.round(px));
    app.style.setProperty("--body-w", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemin", String(BODY_MIN_W));
    handle.setAttribute("aria-valuemax", String(bodyMaxWidth(room())));
  };
  /** True when applied, false when folded. */
  const apply = (raw: number): boolean => {
    const next = resolveBodyWidth(raw, room());
    if (next === null) {
      hooks.fold();
      return false;
    }
    setWidth(next);
    return true;
  };
  const save = (): void => writePref("bodyWidth", body.getBoundingClientRect().width);

  setWidth(readPref("bodyWidth", BODY_DEFAULT_W, isNumber));

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = body.getBoundingClientRect().width;
    app.classList.add("resizing");

    // The handle is on the column's left edge: moving left widens it
    const move = (e: PointerEvent): void => {
      if (!apply(startWidth - (e.clientX - startX))) handle.releasePointerCapture(e.pointerId);
    };
    const end = (): void => {
      app.classList.remove("resizing");
      handle.removeEventListener("pointermove", move);
      if (app.dataset.body !== "hidden") save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", end, { once: true });
  });

  handle.addEventListener("dblclick", () => {
    setWidth(Math.min(BODY_DEFAULT_W, bodyMaxWidth(room())));
    save();
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP;
    if (apply(body.getBoundingClientRect().width + delta)) save();
  });

  // A smaller window lowers the cap: keep the column inside it
  window.addEventListener("resize", () => {
    const width = body.getBoundingClientRect().width;
    if (width > 0 && width > bodyMaxWidth(room())) setWidth(bodyMaxWidth(room()));
    else handle.setAttribute("aria-valuemax", String(bodyMaxWidth(room())));
  });
}
