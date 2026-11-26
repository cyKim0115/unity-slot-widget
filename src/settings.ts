/**
 * Settings: one entry in `SETTINGS` per key of widget.json. Adding an entry makes it appear in the
 * settings popup (shell/settings-dialog.ts) under its category tab. Adapted from
 * https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/settings.ts).
 *
 * Changed from Frond: the values live in widget.json, which the user, their terminal and agents
 * share, so they come from the Rust side (`get_settings`) and a change is stored by
 * `update_settings(patch)` with only the changed keys; Rust reads the file again, merges and clamps.
 * A change applies on screen at once and the save runs after it, one at a time. Labels and hints
 * are i18n keys. Ranges and defaults match src-tauri/src/settings.rs (settings.test.ts compares).
 */

import { call } from "./backend";
import { OPEN_TARGETS, type WidgetSettings } from "./types";

/** Tabs on the left of the popup, in this order. `label` is an i18n key. */
export const SETTING_CATEGORIES = [
  { id: "general", label: "settings.cat.general" },
  { id: "display", label: "settings.cat.display" },
  { id: "open", label: "settings.cat.open" },
  { id: "refresh", label: "settings.cat.refresh" },
  { id: "alerts", label: "settings.cat.alerts" },
  { id: "branchView", label: "settings.cat.branchView" },
  { id: "core", label: "settings.cat.core" },
  { id: "about", label: "settings.cat.about" },
] as const;
export type CategoryId = (typeof SETTING_CATEGORIES)[number]["id"];

interface BaseDef {
  /** The tab this item shows under */
  section: CategoryId;
  /** i18n keys */
  label: string;
  hint?: string;
}
export interface NumberDef extends BaseDef {
  kind: "number";
  default: number;
  min: number;
  max: number;
  /** Spinner step. A whole-number step keeps the value whole (Rust stores an integer). */
  step: number;
  /** i18n key of the unit */
  unit?: string;
  /** Never below this other setting (Rust clamps the same way) */
  atLeast?: string;
}
export interface SelectOption {
  value: string;
  /** i18n key */
  label: string;
}
export interface SelectDef extends BaseDef {
  kind: "select";
  default: string;
  options: readonly SelectOption[];
}
export interface ToggleDef extends BaseDef {
  kind: "toggle";
  default: boolean;
}
export interface TextDef extends BaseDef {
  kind: "text";
  default: string;
  /** i18n key */
  placeholder?: string;
}
export type SettingDef = NumberDef | SelectDef | ToggleDef | TextDef;

export const SETTINGS = {
  language: {
    kind: "select",
    section: "general",
    label: "settings.language",
    default: "auto",
    options: [
      { value: "auto", label: "settings.languageAuto" },
      { value: "ko", label: "lang.ko" },
      { value: "en", label: "lang.en" },
    ],
  },
  closeAction: {
    kind: "select",
    section: "general",
    label: "settings.closeAction",
    hint: "settings.closeAction.hint",
    default: "quit",
    options: [
      { value: "quit", label: "settings.closeQuit" },
      { value: "tray", label: "settings.closeTray" },
      { value: "widget", label: "settings.closeWidget" },
    ],
  },
  windowOnTop: { kind: "toggle", section: "general", label: "settings.windowOnTop", hint: "settings.windowOnTop.hint", default: false },
  startMinimized: {
    kind: "toggle",
    section: "general",
    label: "settings.startMinimized",
    hint: "settings.startMinimized.hint",
    default: true,
  },
  theme: {
    kind: "select",
    section: "display",
    label: "settings.theme",
    hint: "settings.theme.hint",
    default: "system",
    options: [
      { value: "system", label: "theme.system" },
      { value: "light", label: "theme.light" },
      { value: "dark", label: "theme.dark" },
    ],
  },
  themeDurationMs: {
    kind: "number",
    section: "display",
    label: "settings.themeDurationMs",
    hint: "settings.themeDurationMs.hint",
    default: 250,
    min: 0,
    max: 1000,
    step: 50,
    unit: "unit.ms",
  },
  openTarget: {
    kind: "select",
    section: "open",
    label: "settings.openTarget",
    hint: "settings.openTarget.hint",
    default: OPEN_TARGETS[0],
    options: OPEN_TARGETS.map((value) => ({ value, label: `open.${value}` })),
  },
  idleSecs: {
    kind: "number",
    section: "refresh",
    label: "settings.idleSecs",
    hint: "settings.idleSecs.hint",
    default: 30,
    min: 10,
    max: 600,
    step: 5,
    unit: "unit.secs",
  },
  startingSecs: { kind: "number", section: "refresh", label: "settings.startingSecs", default: 5, min: 2, max: 60, step: 1, unit: "unit.secs" },
  gitFullMins: {
    kind: "number",
    section: "refresh",
    label: "settings.gitFullMins",
    hint: "settings.gitFullMins.hint",
    default: 5,
    min: 1,
    max: 120,
    step: 1,
    unit: "unit.mins",
  },
  signalSecs: {
    kind: "number",
    section: "refresh",
    label: "settings.signalSecs",
    hint: "settings.signalSecs.hint",
    default: 3,
    min: 1,
    max: 60,
    step: 1,
    unit: "unit.secs",
  },
  commitWarnPercent: {
    kind: "number",
    section: "alerts",
    label: "settings.commitWarnPercent",
    default: 85,
    min: 50,
    max: 99,
    step: 1,
    unit: "unit.percent",
  },
  commitCriticalPercent: {
    kind: "number",
    section: "alerts",
    label: "settings.commitCriticalPercent",
    hint: "settings.commitCriticalPercent.hint",
    default: 90,
    min: 50,
    max: 100,
    step: 1,
    unit: "unit.percent",
    atLeast: "commitWarnPercent",
  },
  slotMemoryWarnGb: {
    kind: "number",
    section: "alerts",
    label: "settings.slotMemoryWarnGb",
    default: 10,
    min: 1,
    max: 128,
    step: 0.5,
    unit: "unit.gb",
  },
  localOnlyWarnDays: {
    kind: "number",
    section: "alerts",
    label: "settings.localOnlyWarnDays",
    hint: "settings.localOnlyWarnDays.hint",
    default: 3,
    min: 0,
    max: 365,
    step: 1,
    unit: "unit.days",
  },
  localOnlyCriticalDays: {
    kind: "number",
    section: "alerts",
    label: "settings.localOnlyCriticalDays",
    default: 14,
    min: 0,
    max: 365,
    step: 1,
    unit: "unit.days",
  },
  flashTaskbar: { kind: "toggle", section: "alerts", label: "settings.flashTaskbar", hint: "settings.flashTaskbar.hint", default: true },
  branchViewOpenFork: {
    kind: "toggle",
    section: "branchView",
    label: "settings.branchViewOpenFork",
    hint: "settings.branchViewOpenFork.hint",
    default: true,
  },
  unitySlotScript: {
    kind: "text",
    section: "core",
    label: "settings.unitySlotScript",
    hint: "settings.unitySlotScript.hint",
    default: "",
    placeholder: "settings.unitySlotScript.placeholder",
  },
  sampleFile: { kind: "text", section: "core", label: "settings.sampleFile", hint: "settings.sampleFile.hint", default: "" },
} satisfies Record<keyof WidgetSettings, SettingDef>;

export type SettingKey = keyof WidgetSettings;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export const isSettingKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(SETTINGS, key);

/** A stored or typed value made to fit its definition; undefined when it cannot (then: the default). */
export function normalizeSetting(def: SettingDef, raw: unknown): number | string | boolean | undefined {
  switch (def.kind) {
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
      const clamped = Math.min(def.max, Math.max(def.min, n));
      return Number.isInteger(def.step) ? Math.round(clamped) : clamped;
    }
    case "select":
      return def.options.some((o) => o.value === raw) ? (raw as string) : undefined;
    case "toggle":
      return typeof raw === "boolean" ? raw : undefined;
    case "text":
      return typeof raw === "string" ? raw.trim() : undefined;
  }
}

export function defaultSettings(): WidgetSettings {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as unknown as WidgetSettings;
}

/** Rules between two settings (commit critical never below attention), as Rust clamps them. */
function crossFix(values: WidgetSettings): WidgetSettings {
  const out = { ...values } as Record<string, unknown>;
  for (const key of SETTING_KEYS) {
    const def: SettingDef = SETTINGS[key];
    if (def.kind === "number" && def.atLeast) {
      out[key] = Math.max(out[key] as number, out[def.atLeast] as number);
    }
  }
  return out as unknown as WidgetSettings;
}

/** Settings from anything (what Rust sent, a preview object): each known key fitted over the defaults. */
export function readSettings(raw: unknown): WidgetSettings {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const values = defaultSettings() as unknown as Record<string, unknown>;
  for (const key of SETTING_KEYS) {
    const value = normalizeSetting(SETTINGS[key], source[key]);
    if (value !== undefined) values[key] = value;
  }
  return crossFix(values as unknown as WidgetSettings);
}

type Listener = (changed: SettingKey[]) => void;
type Saver = (patch: Partial<WidgetSettings>) => Promise<unknown>;

let values = defaultSettings();
const listeners = new Set<Listener>();
let saveErrorListener: (error: string) => void = () => {};
let saver: Saver = (patch) => call("update_settings", { patch });
/** Values changed here and not yet confirmed by a save: a reload must not undo them */
const pending = new Map<SettingKey, unknown>();
let queue: Promise<void> = Promise.resolve();

export function getSettings(): WidgetSettings {
  return values;
}

export function getSetting<K extends SettingKey>(key: K): WidgetSettings[K] {
  return values[key];
}

export function isDefault(key: SettingKey): boolean {
  return values[key] === SETTINGS[key].default;
}

export function onSettingsChange(listener: Listener): void {
  listeners.add(listener);
}

export function onSettingsSaveError(listener: (error: string) => void): void {
  saveErrorListener = listener;
}

/** Tests: store somewhere else than widget.json. */
export function setSettingsSaver(next: Saver): void {
  saver = next;
}

function commit(next: WidgetSettings): void {
  const changed = SETTING_KEYS.filter((k) => values[k] !== next[k]);
  values = next;
  if (!changed.length) return;
  for (const listener of listeners) listener(changed);
}

/**
 * Takes settings from the Rust side (start, after a save, after someone edited widget.json)
 * without saving them. Changes made here that are still being saved stay on screen.
 */
export function receiveSettings(raw: unknown): void {
  const next = readSettings(raw) as unknown as Record<string, unknown>;
  for (const [key, value] of pending) next[key] = value;
  commit(crossFix(next as unknown as WidgetSettings));
}

/**
 * Applies at once, then stores only the keys that changed (one save at a time). Values that do
 * not fit their definition are skipped. Resolves when this save has finished.
 */
export function patchSettings(patch: Partial<Record<SettingKey, unknown>>): Promise<void> {
  const next = { ...values } as Record<string, unknown>;
  for (const [key, raw] of Object.entries(patch)) {
    if (!isSettingKey(key)) continue;
    const value = normalizeSetting(SETTINGS[key], raw);
    if (value !== undefined) next[key] = value;
  }
  const fixed = crossFix(next as unknown as WidgetSettings);
  const changed: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTING_KEYS) if (fixed[key] !== values[key]) changed[key] = fixed[key];
  const keys = Object.keys(changed) as SettingKey[];
  if (!keys.length) return queue;
  for (const key of keys) pending.set(key, changed[key]);
  commit(fixed);

  const settle = () => {
    for (const key of keys) if (pending.get(key) === changed[key]) pending.delete(key);
  };
  const run = async () => {
    try {
      const saved = await saver(changed as Partial<WidgetSettings>);
      settle();
      if (saved) receiveSettings(saved);
    } catch (error) {
      settle();
      saveErrorListener(String(error));
    }
  };
  queue = queue.then(run);
  return queue;
}

export function setSetting<K extends SettingKey>(key: K, raw: unknown): Promise<void> {
  return patchSettings({ [key]: raw } as Partial<Record<SettingKey, unknown>>);
}

/** 「Reset all」: one save with every key that is not at its default. */
export function resetSettings(): Promise<void> {
  return patchSettings(defaultSettings() as unknown as Partial<Record<SettingKey, unknown>>);
}
