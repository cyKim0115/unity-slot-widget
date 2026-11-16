/**
 * Screen state (side panel open and tab, column widths, selection, filters, the theme mirror) in
 * localStorage. Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author
 * (src/prefs.ts; the old-prefix migration is left out).
 *
 * Settings are not here: they live in widget.json, shared with the terminal and agents. This is
 * per-PC convenience state only, so a blocked store or a broken value falls back to the default.
 */

export const PREFS_PREFIX = "unity-slot-widget.";

export function readPref<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(PREFS_PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFS_PREFIX + key, JSON.stringify(value));
  } catch {
    // full or blocked: the next start uses the default
  }
}

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isString = (value: unknown): value is string => typeof value === "string";
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
