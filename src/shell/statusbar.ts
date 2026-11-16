/**
 * Status bar helpers: the left slot shows the selected item's path, or a short notice for a moment
 * (`flashStatus`, instead of toasts); items marked `data-drop="n"` give way in order 1, 2, 3...
 * when the bar is too narrow (the path shrinks first on its own). Adapted from
 * https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/main.ts flashStatus).
 */

const bar = document.querySelector<HTMLElement>("#statusbar")!;
const pathEl = document.querySelector<HTMLElement>("#status-path")!;
/** role="status": screen readers read the notices out (the path slot itself changes too often). */
const liveEl = document.querySelector<HTMLElement>("#status-live");

let baseText = "";
let baseTitle = "";
let flashTimer = 0;
let flashing = false;

function paintBase(): void {
  pathEl.textContent = baseText;
  pathEl.title = baseTitle;
  pathEl.classList.remove("flash");
  // Nothing to copy: no empty, nameless button in the Tab order
  pathEl.tabIndex = baseText ? 0 : -1;
}

/** The resting content of the left slot. A notice on screen keeps its time. */
export function setStatusPath(text: string, title = text): void {
  baseText = text;
  baseTitle = title;
  if (!flashing) paintBase();
}

/** Shows `message` in the left slot for `ms`, then the path again. A new notice replaces the old. */
export function flashStatus(message: string, ms = 2200): void {
  flashing = true;
  pathEl.textContent = message;
  pathEl.title = message;
  pathEl.classList.add("flash");
  if (liveEl) {
    // Emptied first, so the same notice twice is read out twice
    liveEl.textContent = "";
    window.setTimeout(() => (liveEl.textContent = message), 30);
  }
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    flashing = false;
    paintBase();
  }, ms);
}

export function isFlashing(): boolean {
  return flashing;
}

/** Hides `[data-drop]` items, lowest number first, until the bar fits. */
export function fitStatusbar(): void {
  const items = Array.from(bar.querySelectorAll<HTMLElement>("[data-drop]")).sort(
    (a, b) => Number(a.dataset.drop) - Number(b.dataset.drop),
  );
  for (const el of items) el.classList.remove("dropped");
  for (const el of items) {
    if (bar.scrollWidth <= bar.clientWidth) break;
    el.classList.add("dropped");
  }
}
