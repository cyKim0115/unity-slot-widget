/**
 * Title bar drawn by the app: the window has no OS frame (decorations off), and the header strip of
 * each column (.col-header) reaches the top edge, so together they form the title bar.
 * Pressing an empty part of a strip moves the window (native move loop, so Aero Snap works); a
 * double press toggles maximize. Caption glyphs come from the Windows icon fonts (Segoe Fluent / MDL2).
 * Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/titlebar.ts).
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "../i18n";

const GLYPH_MAXIMIZE = "\uE922";
const GLYPH_RESTORE = "\uE923";

export interface Titlebar {
  /** Writes the caption button labels again (language change). */
  relabel(): void;
}

function label(button: HTMLElement, text: string): void {
  button.title = text;
  button.setAttribute("aria-label", text);
}

/** `live` false (browser preview): labels only, the buttons do nothing. */
export function initTitlebar(live: boolean): Titlebar {
  const minButton = document.querySelector<HTMLButtonElement>("#win-min")!;
  const maxButton = document.querySelector<HTMLButtonElement>("#win-max")!;
  const closeButton = document.querySelector<HTMLButtonElement>("#win-close")!;
  let maximized = false;

  const relabel = (): void => {
    label(minButton, t("titlebar.minimize"));
    label(maxButton, t(maximized ? "titlebar.restore" : "titlebar.maximize"));
    label(closeButton, t("titlebar.close"));
    maxButton.textContent = maximized ? GLYPH_RESTORE : GLYPH_MAXIMIZE;
  };
  relabel();
  if (!live) return { relabel };

  const win = getCurrentWindow();
  minButton.addEventListener("click", () => void win.minimize());
  maxButton.addEventListener("click", () => void win.toggleMaximize());
  closeButton.addEventListener("click", () => void win.close());

  // Same rule as Tauri's drag.js: the first press starts the native move loop, the second
  // (detail 2) toggles maximize. Not on buttons, links, fields, handles or tabs.
  document.addEventListener("mousedown", (event) => {
    const target = event.target as Element;
    if (event.button !== 0 || !target.closest(".drag-region")) return;
    if (target.closest("button, a, input, select, [role='separator'], [role='tab']")) return;
    event.preventDefault();
    void (event.detail === 2 ? win.toggleMaximize() : win.startDragging());
  });

  const syncMaximized = async (): Promise<void> => {
    try {
      maximized = await win.isMaximized();
    } catch {
      return;
    }
    relabel();
  };
  void syncMaximized();
  void win.onResized(() => void syncMaximized());
  return { relabel };
}
