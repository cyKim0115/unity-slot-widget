/**
 * Banner under the title bar: one thing a person should act on now, with buttons. Closing it with
 * its × hides it until the content changes (a different `key`). Adapted from
 * https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/main.ts showBanner, paintBanner,
 * hideBanner; one banner for the window instead of one per document tab).
 */

import { t } from "../i18n";
import { ICON_CLOSE, icon } from "./icons";

export interface BannerAction {
  label: string;
  run: () => void;
}

export interface BannerState {
  /** Same key = same banner. A banner closed with × stays hidden while its key is shown again. */
  key: string;
  message: string;
  actions?: BannerAction[];
  /** Danger tint instead of the accent tint. */
  warn?: boolean;
}

const banner = document.querySelector<HTMLElement>("#banner")!;
const textEl = document.querySelector<HTMLElement>("#banner-text")!;
const actionsEl = document.querySelector<HTMLElement>("#banner-actions")!;
const closeButton = document.querySelector<HTMLButtonElement>("#banner-close")!;

let shownKey: string | null = null;
let dismissedKey: string | null = null;
/** Where the focus goes when the banner hides while it had it. */
let focusHome: () => void = () => {};

closeButton.append(icon(ICON_CLOSE));
closeButton.addEventListener("click", () => {
  dismissedKey = shownKey;
  hideBanner();
});

export function setBannerFocusHome(fn: () => void): void {
  focusHome = fn;
}

/** Labels that do not come with a state (language change). */
export function relabelBanner(): void {
  closeButton.title = t("banner.close");
  closeButton.setAttribute("aria-label", t("banner.close"));
}

/** Shows `state`, or hides the banner for null. Repaints only when something changed. */
export function showBanner(state: BannerState | null): void {
  if (!state) {
    dismissedKey = null;
    hideBanner();
    return;
  }
  if (state.key === dismissedKey) {
    hideBanner();
    return;
  }
  dismissedKey = null;
  shownKey = state.key;
  textEl.textContent = state.message;
  actionsEl.replaceChildren(
    ...(state.actions ?? []).map((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.addEventListener("click", a.run);
      return b;
    }),
  );
  banner.classList.toggle("warn", state.warn === true);
  banner.hidden = false;
}

export function hideBanner(): void {
  // Hiding the focused button would drop the focus to <body>: give it back to the screen
  const hadFocus = banner.contains(document.activeElement);
  banner.hidden = true;
  shownKey = null;
  if (hadFocus) focusHome();
}
