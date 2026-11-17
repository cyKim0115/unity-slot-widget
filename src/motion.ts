/**
 * Small motion for the list and the details column. The list is drawn again from HTML on every
 * refresh, so this works the FLIP way: measure the items before drawing, then play each item from
 * where it was to where it is now. Items are the list's `[data-item]` elements (slot rows, group
 * heads, branch rows), matched by their key.
 *
 * - An item that changed place (an editor opened or closed and the slot moved, a group above
 *   folded or opened) slides there.
 * - An item that was not there before fades in (a group opened, a filter let it in).
 * - A slot whose editor just opened, or just became ready, glows once.
 * - Another screen (slots / branches) fades in as a whole instead of sliding item by item.
 * - The details column fades in when another item is selected.
 *
 * Every effect plays once and is short (no repeating animation). Nothing plays with reduced motion,
 * while the window is hidden, on the first draw, while a width is being dragged, when the list
 * width changed (items that only wrapped differently did not move) or when more than MAX_MOVING
 * items would move at once (a filter change on a long list): then the list simply shows its new
 * state.
 */

/** Above this many moving items the list just switches; one refresh never plays more. */
export const MAX_MOVING = 24;
const MOVE_MS = 280;
const ENTER_MS = 180;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const OPEN_STATES = new Set(["starting", "ready", "unknown", "stalled"]);

const ITEM = "[data-item]";

interface Mark {
  top: number;
  state: string;
}

export interface ListSnapshot {
  /** Which screen was drawn (another screen fades in instead of sliding). */
  screen: string;
  width: number;
  marks: Map<string, Mark>;
}

const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** False when motion should not play now (see the file comment). */
export function motionAllowed(): boolean {
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return false;
  if (document.hidden || reduced?.matches) return false;
  const app = document.getElementById("app");
  return !(app?.classList.contains("no-anim") || app?.classList.contains("resizing"));
}

/** The editor state of a slot row (`state-ready` ...); empty for other items. */
function stateOf(el: Element): string {
  if (!el.classList.contains("slot")) return "";
  for (const c of el.classList) if (c.startsWith("state-")) return c.slice(6);
  return "";
}

function items(inner: HTMLElement): HTMLElement[] {
  return Array.from(inner.querySelectorAll<HTMLElement>(ITEM));
}

/**
 * Where each item is now, relative to the list (so scrolling in between does not count as a
 * move). Null when nothing is drawn yet.
 */
export function snapshotList(inner: HTMLElement, screen: string): ListSnapshot | null {
  const els = items(inner);
  if (!els.length) return null;
  const base = inner.getBoundingClientRect().top;
  const marks = new Map<string, Mark>();
  for (const el of els) {
    const key = el.dataset.item;
    if (key) marks.set(key, { top: el.getBoundingClientRect().top - base, state: stateOf(el) });
  }
  return { screen, width: inner.clientWidth, marks };
}

/** Plays the list from `before` (taken just before drawing `screen`) to what is drawn now. */
export function playList(inner: HTMLElement, before: ListSnapshot | null, screen: string): void {
  if (!before || !motionAllowed()) return;
  if (before.screen !== screen) {
    fadeIn(inner);
    return;
  }
  if (inner.clientWidth !== before.width) return;
  const base = inner.getBoundingClientRect().top;
  const moves: Array<[HTMLElement, number]> = [];
  const enters: HTMLElement[] = [];
  const glows: Array<[HTMLElement, string]> = [];
  for (const el of items(inner)) {
    const key = el.dataset.item;
    if (!key) continue;
    const was = before.marks.get(key);
    if (!was) {
      enters.push(el);
      continue;
    }
    const dy = was.top - (el.getBoundingClientRect().top - base);
    if (Math.abs(dy) >= 1) moves.push([el, dy]);
    const now = stateOf(el);
    if (now && now !== was.state && OPEN_STATES.has(now)) {
      if (!OPEN_STATES.has(was.state)) glows.push([el, "glow-open"]);
      else if (now === "ready") glows.push([el, "glow-ready"]);
    }
  }
  if (moves.length + enters.length > MAX_MOVING) return;
  for (const [el, dy] of moves) {
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: MOVE_MS, easing: EASE });
  }
  for (const el of enters) {
    el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }], {
      duration: ENTER_MS,
      easing: "ease-out",
    });
  }
  // CSS plays the glow once (slots.css); the class goes with the row on the next draw
  for (const [el, cls] of glows) el.classList.add(cls);
}

/** Fades `el` in once, for content that just replaced other content. */
export function fadeIn(el: HTMLElement | null, rise = 4): void {
  if (!el || !motionAllowed()) return;
  el.animate([{ opacity: 0, transform: `translateY(${rise}px)` }, { opacity: 1, transform: "translateY(0)" }], {
    duration: ENTER_MS,
    easing: "ease-out",
  });
}
