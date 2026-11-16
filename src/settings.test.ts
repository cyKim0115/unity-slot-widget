/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import rustSettings from "../src-tauri/src/settings.rs?raw";
import rustOpen from "../src-tauri/src/open.rs?raw";
import panelsSource from "./settings-panels.ts?raw";
import dialogSource from "./shell/settings-dialog.ts?raw";
import en from "./i18n/en.json";
import ko from "./i18n/ko.json";
import {
  defaultSettings,
  getSetting,
  getSettings,
  normalizeSetting,
  onSettingsChange,
  patchSettings,
  readSettings,
  receiveSettings,
  resetSettings,
  SETTING_CATEGORIES,
  SETTING_KEYS,
  SETTINGS,
  setSettingsSaver,
  type SettingDef,
} from "./settings";
import { OPEN_TARGETS } from "./types";

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** `field: value,` lines of `impl Default for WidgetSettings`. */
function rustDefaults(): Record<string, string> {
  const start = rustSettings.indexOf("impl Default for WidgetSettings");
  const body = rustSettings.slice(start, rustSettings.indexOf("\n    }\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s+(\w+): (.+),$/gm)) out[camel(m[1])] = m[2];
  return out;
}

function rustDefaultValue(text: string): unknown {
  if (text === "true" || text === "false") return text === "true";
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === "String::new()") return "";
  const literal = /^"([^"]*)"\.into\(\)$/.exec(text);
  if (literal) return literal[1];
  if (text === "crate::open::OPEN_TARGETS[0].into()") return OPEN_TARGETS[0];
  throw new Error(`unread default ${text}`);
}

/** `self.x = self.x.clamp(min, max);` lines of `fn clamp`. */
function rustClamps(): Record<string, { min: string; max: string }> {
  const out: Record<string, { min: string; max: string }> = {};
  for (const m of rustSettings.matchAll(/self\.(\w+) = self\.\1\.clamp\(([^,]+), ([^)]+)\);/g)) {
    out[camel(m[1])] = { min: m[2].trim(), max: m[3].trim() };
  }
  return out;
}

/** `if !matches!(self.x.as_str(), "a" | "b")` lines of `fn clamp`. */
function rustChoices(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of rustSettings.matchAll(/matches!\(self\.(\w+)\.as_str\(\), ([^)]+)\)/g)) {
    out[camel(m[1])] = [...m[2].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
  }
  return out;
}

describe("schema and src-tauri/src/settings.rs agree", () => {
  it("has the same keys as the Rust struct and its KEYS list", () => {
    const defaults = rustDefaults();
    expect(Object.keys(defaults).sort()).toEqual([...SETTING_KEYS].sort());
    const keysList = /pub const KEYS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rustSettings)![1];
    // Same set; the order differs on purpose (file order there, screen order here)
    expect([...keysList.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("has the same defaults", () => {
    const defaults = rustDefaults();
    for (const key of SETTING_KEYS) expect(SETTINGS[key].default, key).toEqual(rustDefaultValue(defaults[key]));
  });

  it("has the same number ranges", () => {
    const clamps = rustClamps();
    const numbers = SETTING_KEYS.filter((k) => SETTINGS[k].kind === "number");
    expect(Object.keys(clamps).sort()).toEqual([...numbers].sort());
    for (const key of numbers) {
      const def = SETTINGS[key] as SettingDef & { kind: "number" };
      const { min, max } = clamps[key];
      expect(Number(max), `${key} max`).toBe(def.max);
      if (min.startsWith("self.")) {
        // commit critical: never below the attention value, whose own floor is the same
        const other = camel(min.slice(5));
        expect(def.atLeast, `${key} atLeast`).toBe(other);
        expect(def.min, `${key} min`).toBe((SETTINGS[other as keyof typeof SETTINGS] as { min: number }).min);
      } else {
        expect(Number(min), `${key} min`).toBe(def.min);
        expect(def.atLeast, `${key} atLeast`).toBeUndefined();
      }
    }
  });

  it("has the same choices", () => {
    const choices = rustChoices();
    for (const [key, values] of Object.entries(choices)) {
      const def = SETTINGS[key as keyof typeof SETTINGS] as SettingDef;
      expect(def.kind, key).toBe("select");
      if (def.kind === "select") expect(def.options.map((o) => o.value), key).toEqual(values);
    }
    const targets = /OPEN_TARGETS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rustOpen)![1];
    expect([...targets.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...OPEN_TARGETS]);
    expect(SETTINGS.openTarget.options.map((o) => o.value)).toEqual([...OPEN_TARGETS]);
  });
});

describe("categories and texts", () => {
  it("puts every item under a known tab", () => {
    const ids = new Set<string>(SETTING_CATEGORIES.map((c) => c.id));
    for (const key of SETTING_KEYS) expect(ids, key).toContain(SETTINGS[key].section);
    expect(new Set(SETTING_CATEGORIES.map((c) => c.id)).size).toBe(SETTING_CATEGORIES.length);
  });

  it("has every label, hint, unit and option text in both tables", () => {
    const keys: string[] = SETTING_CATEGORIES.map((c) => c.label);
    for (const key of SETTING_KEYS) {
      const def: SettingDef = SETTINGS[key];
      keys.push(def.label);
      if (def.hint) keys.push(def.hint);
      if (def.kind === "number" && def.unit) keys.push(def.unit);
      if (def.kind === "select") keys.push(...def.options.map((o) => o.label));
      if (def.kind === "text" && def.placeholder) keys.push(def.placeholder);
    }
    // Keys the panels and the popup pass around as plain strings (not t("...") calls)
    for (const source of [panelsSource, dialogSource]) {
      for (const m of source.matchAll(/"((?:settings|toast|lang|theme|unit)\.[\w.]+)"/g)) keys.push(m[1]);
    }
    for (const key of keys) {
      expect(ko, key).toHaveProperty([key]);
      expect(en, key).toHaveProperty([key]);
    }
  });
});

describe("normalizeSetting", () => {
  it("clamps numbers and keeps whole-number settings whole", () => {
    expect(normalizeSetting(SETTINGS.idleSecs, 3)).toBe(10);
    expect(normalizeSetting(SETTINGS.idleSecs, 10_000)).toBe(600);
    expect(normalizeSetting(SETTINGS.idleSecs, "42.4")).toBe(42);
    expect(normalizeSetting(SETTINGS.slotMemoryWarnGb, "10.3")).toBe(10.3);
    expect(normalizeSetting(SETTINGS.idleSecs, "")).toBeUndefined();
    expect(normalizeSetting(SETTINGS.idleSecs, "soon")).toBeUndefined();
  });

  it("takes only listed choices, booleans for toggles and trimmed text", () => {
    expect(normalizeSetting(SETTINGS.theme, "dark")).toBe("dark");
    expect(normalizeSetting(SETTINGS.theme, "neon")).toBeUndefined();
    expect(normalizeSetting(SETTINGS.windowOnTop, "true")).toBeUndefined();
    expect(normalizeSetting(SETTINGS.windowOnTop, true)).toBe(true);
    expect(normalizeSetting(SETTINGS.unitySlotScript, "  C:\\tools\\unity-slot.ps1 ")).toBe("C:\\tools\\unity-slot.ps1");
  });

  it("reads a whole object key by key, and keeps commit critical above attention", () => {
    const s = readSettings({ idleSecs: "x", signalSecs: 7, alwaysOnTop: true, commitWarnPercent: 95, commitCriticalPercent: 90 });
    expect(s.idleSecs).toBe(30);
    expect(s.signalSecs).toBe(7);
    expect(s.commitCriticalPercent).toBe(95);
    expect("alwaysOnTop" in s).toBe(false);
  });
});

describe("store", () => {
  let saved: Partial<Record<string, unknown>>[];
  let file: Record<string, unknown>;

  beforeEach(async () => {
    saved = [];
    file = { alwaysOnTop: true };
    setSettingsSaver(async (patch) => {
      saved.push({ ...patch });
      Object.assign(file, patch);
      return { ...file };
    });
    receiveSettings(defaultSettings());
    await resetSettings();
    saved = [];
  });

  it("applies at once and stores only the changed key", async () => {
    const listener = vi.fn();
    onSettingsChange(listener);
    const done = patchSettings({ theme: "dark", idleSecs: 30 });
    expect(getSetting("theme")).toBe("dark");
    expect(listener).toHaveBeenCalledWith(["theme"]);
    await done;
    expect(saved).toEqual([{ theme: "dark" }]);
    // The file's other keys stay: the saver merged
    expect(file.alwaysOnTop).toBe(true);
  });

  it("does not save a value that did not change or does not fit", async () => {
    await patchSettings({ theme: "system", idleSecs: "soon" });
    expect(saved).toEqual([]);
  });

  it("raises commit critical with attention and saves both", async () => {
    await patchSettings({ commitWarnPercent: 95 });
    expect(getSettings().commitCriticalPercent).toBe(95);
    expect(saved).toEqual([{ commitWarnPercent: 95, commitCriticalPercent: 95 }]);
  });

  it("keeps a change being saved when a reload arrives", async () => {
    let release: (() => void) | undefined;
    setSettingsSaver(
      (patch) =>
        new Promise((resolve) => {
          release = () => resolve({ ...file, ...patch });
        }),
    );
    const done = patchSettings({ windowOnTop: true });
    // widget.json changed elsewhere while the save is on its way
    receiveSettings({ ...file, signalSecs: 9 });
    expect(getSettings().windowOnTop).toBe(true);
    expect(getSettings().signalSecs).toBe(9);
    // The save starts after the current task
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release!();
    await done;
    expect(getSettings().windowOnTop).toBe(true);
  });

  it("resets everything that is not at its default in one save", async () => {
    await patchSettings({ theme: "dark" });
    await patchSettings({ idleSecs: 60 });
    saved = [];
    await resetSettings();
    expect(saved).toEqual([{ theme: "system", idleSecs: 30 }]);
    expect(getSettings()).toEqual(defaultSettings());
  });
});
