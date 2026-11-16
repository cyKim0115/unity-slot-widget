/**
 * App shortcuts: one keydown listener in the capture phase, so the app sees a key before anything
 * inside the page. Keys are skipped during IME composition (Korean input) and while a <dialog> is
 * open (the dialog owns them). Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same
 * author (src/main.ts onShortcutKey, written here as a table).
 *
 * A combo is "Ctrl+Shift+D", "F5", "Ctrl+\\", "Ctrl+1", "Shift+F10"... Letters, digits, "\\" and ","
 * match the physical key (event.code), so a Korean layout gives the same result; other names
 * match event.key. Ctrl also accepts the Meta key.
 */

export interface Shortcut {
  keys: string;
  /** Return false to leave the key alone (default action, next shortcut). */
  run: (event: KeyboardEvent) => boolean | void;
  /** Also when the focus is in a text field (find box). Default: not. */
  inFields?: boolean;
}

interface Combo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  code: string | null;
  key: string | null;
}

const PUNCTUATION: Record<string, string> = { "\\": "Backslash", ",": "Comma", "/": "Slash", ".": "Period" };

export function parseCombo(text: string): Combo {
  const parts = text.split("+");
  // "Ctrl++" style is not used; the last part is the key
  const name = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  let code: string | null = null;
  let key: string | null = null;
  if (/^[A-Za-z]$/.test(name)) code = `Key${name.toUpperCase()}`;
  else if (/^[0-9]$/.test(name)) code = `Digit${name}`;
  else if (name in PUNCTUATION) code = PUNCTUATION[name];
  else key = name;
  return { ctrl: mods.has("ctrl"), shift: mods.has("shift"), alt: mods.has("alt"), code, key };
}

export function matchesCombo(event: KeyboardEvent, combo: Combo): boolean {
  if ((event.ctrlKey || event.metaKey) !== combo.ctrl) return false;
  if (event.shiftKey !== combo.shift || event.altKey !== combo.alt) return false;
  return combo.code !== null ? event.code === combo.code : event.key === combo.key;
}

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function createShortcutHandler(shortcuts: Shortcut[]): (event: KeyboardEvent) => void {
  const table = shortcuts.map((s) => ({ ...s, combo: parseCombo(s.keys) }));
  return (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (document.querySelector("dialog[open]")) return;
    const field = inTextField(event.target);
    for (const s of table) {
      if (field && !s.inFields) continue;
      if (!matchesCombo(event, s.combo)) continue;
      if (s.run(event) === false) continue;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };
}

export function initKeys(shortcuts: Shortcut[]): void {
  window.addEventListener("keydown", createShortcutHandler(shortcuts), { capture: true });
}
