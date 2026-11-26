/**
 * The main window's rounded frame (src/shell/frame.css): square while maximized, and the transparent
 * margin around the card works as the resize border. Tauri's own resize border of an undecorated
 * window is only the outermost few pixels (SM_CXFRAME); the rest of the margin is page, so a press
 * there starts the native resize loop for that edge (`startResizeDragging`), and the cursor shows it.
 */

import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export type ResizeEdge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

/** Within this many px of a corner along an edge, the margin resizes both ways. */
const CORNER_PX = 16;

const CURSORS: Record<ResizeEdge, string> = {
  North: "ns-resize",
  South: "ns-resize",
  East: "ew-resize",
  West: "ew-resize",
  NorthEast: "nesw-resize",
  SouthWest: "nesw-resize",
  NorthWest: "nwse-resize",
  SouthEast: "nwse-resize",
};

/**
 * The edge a point (`x`, `y` in a `w` x `h` window) is on when it lies in the outer `margin` px;
 * null inside the card. Near a corner (CORNER_PX) it is that corner.
 */
export function edgeAt(x: number, y: number, w: number, h: number, margin: number): ResizeEdge | null {
  if (margin <= 0) return null;
  const top = y < margin;
  const bottom = y >= h - margin;
  const left = x < margin;
  const right = x >= w - margin;
  if (!top && !bottom && !left && !right) return null;
  const side = left || right;
  const cap = top || bottom;
  const ns = top || (side && y < CORNER_PX) ? "North" : bottom || (side && y >= h - CORNER_PX) ? "South" : "";
  const ew = left || (cap && x < CORNER_PX) ? "West" : right || (cap && x >= w - CORNER_PX) ? "East" : "";
  return (ns + ew) as ResizeEdge;
}

function marginPx(): number {
  return parseFloat(getComputedStyle(document.body).paddingTop) || 0;
}

/** Maximized: no margin and square corners. */
export function setFlat(flat: boolean): void {
  if (flat) document.documentElement.dataset.frame = "flat";
  else delete document.documentElement.dataset.frame;
}

/** `live` false (browser preview): the frame is drawn, the margin does nothing. */
export function initFrame(live: boolean): void {
  if (!live) return;
  const win: Window = getCurrentWindow();
  // Only the margin itself: the card (#app) and popups have their own targets
  const inMargin = (e: MouseEvent): ResizeEdge | null => {
    if (e.target !== document.body && e.target !== document.documentElement) return null;
    return edgeAt(e.clientX, e.clientY, window.innerWidth, window.innerHeight, marginPx());
  };
  document.addEventListener("mousemove", (e) => {
    const edge = inMargin(e);
    document.body.style.cursor = edge ? CURSORS[edge] : "";
  });
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const edge = inMargin(e);
    if (!edge) return;
    e.preventDefault();
    void win.startResizeDragging(edge);
  });
}
