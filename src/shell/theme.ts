/**
 * Light, dark or follow the system. Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT,
 * same author (src/theme/themes.ts shell part: SHELL_TOKENS, applyTheme, registerColorTokens,
 * themeTransitionCss; src/main.ts applyEffectiveTheme and toggleTheme). There are no theme files
 * here: the values live in theme/tokens.css and theme/dark.css, and this module only sets
 * `data-theme` on <html> and fades the change.
 *
 * - The choice ("system" | "light" | "dark") comes from the settings (widget.json). The last one is
 *   mirrored to localStorage so src/public/theme-boot.js can apply it before the first paint.
 * - A change fades over `ms` milliseconds: the color tokens are registered as <color> so a
 *   transition on <html> can interpolate them. The first apply, 0 ms and "reduce motion" switch at once.
 */

import { readPref, writePref } from "./prefs";

export type ThemeChoice = "system" | "light" | "dark";
export type ThemeBase = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Frond's eight shell tokens (same names and values as Frond). */
export const SHELL_TOKENS = ["fg", "bg", "muted", "line", "accent", "on-accent", "danger", "sidebar-bg"] as const;

/** This app's status tokens and the colors that used to be literals. */
export const STATUS_TOKENS = [
  "ok",
  "warn",
  "hot",
  "info",
  "batch",
  "tint-warn",
  "tint-warn-line",
  "tint-hot",
  "tint-hot-line",
  "on-danger",
  "caption-close",
  "on-caption-close",
] as const;

export const COLOR_TOKEN_NAMES: readonly string[] = [...SHELL_TOKENS, ...STATUS_TOKENS].map((k) => `--${k}`);

/** localStorage key (after the prefs prefix) read by theme-boot.js. */
export const THEME_MIRROR_KEY = "theme";

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "system" || value === "light" || value === "dark";

export function resolveBase(choice: ThemeChoice, systemDark: boolean): ThemeBase {
  if (choice === "light" || choice === "dark") return choice;
  return systemDark ? "dark" : "light";
}

/** Ctrl+Shift+D: pin the side opposite to what is on screen (it stops following the system). */
export function oppositeChoice(base: ThemeBase): ThemeChoice {
  return base === "dark" ? "light" : "dark";
}

let registered = false;

/**
 * Registers the color tokens as <color>; only registered custom properties interpolate in a
 * transition. Once, and nothing where the API is missing (jsdom).
 */
export function registerColorTokens(): boolean {
  if (registered) return true;
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return false;
  for (const name of COLOR_TOKEN_NAMES) {
    try {
      CSS.registerProperty({ name, syntax: "<color>", inherits: true, initialValue: "transparent" });
    } catch {
      // already registered (hot reload)
    }
  }
  registered = true;
  return true;
}

/** Rule that interpolates the tokens while `html.theme-anim` is on. The tokens live on :root only. */
export function themeTransitionCss(ms: number): string {
  const list = COLOR_TOKEN_NAMES.map((n) => `${n} ${ms}ms ease`).join(", ");
  return `html.theme-anim { transition: ${list}; }\n`;
}

export interface ThemeController {
  /** Applies a choice. Fades unless it is the first apply, `ms` is 0 or motion is reduced. */
  apply(choice: ThemeChoice, ms: number): void;
  /** The light/dark side on screen now. */
  base(): ThemeBase;
  choice(): ThemeChoice;
}

export function initTheme(onSystemChange?: () => void): ThemeController {
  const root = document.documentElement;
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const canInterpolate = registerColorTokens();
  let current: ThemeChoice = readPref(THEME_MIRROR_KEY, "system", isThemeChoice);
  let lastMs = 250;
  let applied = false;
  let animTimer = 0;

  function transitionStyle(ms: number): void {
    let style = document.getElementById("theme-anim") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "theme-anim";
      document.head.append(style);
    }
    style.textContent = themeTransitionCss(ms);
  }

  function paint(ms: number): void {
    const base = resolveBase(current, systemDark.matches);
    const duration = reducedMotion.matches ? 0 : ms;
    // Same side again (settings saved, language changed): leave a running fade alone
    if (applied && root.dataset.theme === base) return;
    if (!applied || duration === 0 || !canInterpolate) {
      root.classList.remove("theme-anim");
      root.dataset.theme = base;
      applied = true;
      return;
    }
    transitionStyle(duration);
    root.classList.add("theme-anim");
    root.dataset.theme = base;
    window.clearTimeout(animTimer);
    animTimer = window.setTimeout(() => root.classList.remove("theme-anim"), duration + 80);
  }

  systemDark.addEventListener("change", () => {
    if (current !== "system") return;
    paint(lastMs);
    onSystemChange?.();
  });

  return {
    apply(choice, ms) {
      current = choice;
      lastMs = ms;
      writePref(THEME_MIRROR_KEY, choice);
      paint(ms);
    },
    base: () => resolveBase(current, systemDark.matches),
    choice: () => current,
  };
}
