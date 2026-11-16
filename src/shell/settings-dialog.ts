/**
 * Settings popup: category tabs down the left, the chosen tab's items on the right. Tabs come from
 * `SETTING_CATEGORIES`, items from the `SETTINGS` schema (src/settings.ts); what the schema cannot
 * draw (Start with Windows, where the core was found, the About facts) is added with
 * `addPanel(category, element, after)`. A change applies and saves at once (no save button), each
 * item has a reset button while it differs from its default, and 「Reset all」 sits at the bottom.
 * Numbers and text are taken on `change` (focus leaves, Enter, spinner) so a value half typed is
 * never applied. Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author
 * (src/settings-dialog.ts): toggle and text items, texts from i18n, `relabel()` for a language
 * change, panels placed after an item, an `onOpen` hook, Enter in a field does not close the popup.
 */

import { t } from "../i18n";
import {
  type CategoryId,
  getSetting,
  isDefault,
  onSettingsChange,
  resetSettings,
  SETTING_CATEGORIES,
  SETTING_KEYS,
  SETTINGS,
  setSetting,
  type SettingDef,
  type SettingKey,
} from "../settings";
import { ICON_RESET, icon } from "./icons";
import { isString, readPref, writePref } from "./prefs";

type Control = HTMLInputElement | HTMLSelectElement;

const dialog = document.querySelector<HTMLDialogElement>("#settings-dialog")!;
const body = dialog.querySelector<HTMLElement>("#settings-body")!;
const controls = new Map<SettingKey, Control>();
const resetButtons = new Map<SettingKey, HTMLButtonElement>();
const tabs = new Map<CategoryId, HTMLButtonElement>();
const panels = new Map<CategoryId, HTMLElement>();
const extras: { category: CategoryId; element: HTMLElement; after?: SettingKey }[] = [];
const openHooks: (() => void)[] = [];

let selected: CategoryId = SETTING_CATEGORIES[0].id;

/** The value as the control shows it. */
function shown(key: SettingKey): string {
  return String(getSetting(key));
}

function commitControl(key: SettingKey, control: Control): void {
  const def: SettingDef = SETTINGS[key];
  const raw = def.kind === "toggle" ? (control as HTMLInputElement).checked : control.value;
  // The value applies before the save starts; the field shows what the setting made of it
  // (out of range, empty, spaces), and again what the saved file holds afterwards
  void setSetting(key, raw).then(() => sync(key));
  if (def.kind === "toggle") (control as HTMLInputElement).checked = getSetting(key) === true;
  else control.value = shown(key);
  resetButtons.get(key)!.hidden = isDefault(key);
}

function buildControl(key: SettingKey, def: SettingDef): Control {
  let control: Control;
  if (def.kind === "select") {
    const select = document.createElement("select");
    select.replaceChildren(...def.options.map((o) => new Option(t(o.label), o.value)));
    control = select;
  } else {
    const input = document.createElement("input");
    if (def.kind === "number") {
      input.type = "number";
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.inputMode = Number.isInteger(def.step) ? "numeric" : "decimal";
    } else if (def.kind === "toggle") {
      input.type = "checkbox";
      input.className = "switch";
      input.setAttribute("role", "switch");
    } else {
      input.type = "text";
      input.spellcheck = false;
      input.autocomplete = "off";
      if (def.placeholder) input.placeholder = t(def.placeholder);
    }
    control = input;
  }
  control.addEventListener("change", () => commitControl(key, control));
  // Enter would submit the popup's form (and close it): take the value instead
  control.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Enter" || control instanceof HTMLSelectElement || def.kind === "toggle") return;
    event.preventDefault();
    commitControl(key, control);
  });
  return control;
}

function defaultLabel(def: SettingDef): string {
  switch (def.kind) {
    case "number":
      return def.unit ? `${def.default} ${t(def.unit)}` : String(def.default);
    case "select":
      return t(def.options.find((o) => o.value === def.default)?.label ?? def.default);
    case "toggle":
      return t(def.default ? "settings.on" : "settings.off");
    case "text":
      return def.default === "" ? t("settings.empty") : def.default;
  }
}

function buildRow(key: SettingKey, def: SettingDef): HTMLElement {
  const id = `setting-${key}`;
  const row = document.createElement("div");
  row.className = def.kind === "text" ? "setting-row wide" : "setting-row";

  const label = document.createElement("label");
  label.htmlFor = id;
  const name = document.createElement("span");
  name.className = "setting-label";
  name.textContent = t(def.label);
  label.append(name);
  if (def.hint) {
    const hint = document.createElement("span");
    hint.className = "setting-hint";
    hint.id = `${id}-hint`;
    hint.textContent = t(def.hint);
    label.append(hint);
  }

  const control = buildControl(key, def);
  control.id = id;
  if (def.hint) control.setAttribute("aria-describedby", `${id}-hint`);
  const wrap = document.createElement("div");
  wrap.className = "setting-control";
  wrap.append(control);
  if (def.kind === "number" && def.unit) {
    const unit = document.createElement("span");
    unit.className = "setting-unit";
    unit.textContent = t(def.unit);
    wrap.append(unit);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "icon-btn small setting-reset";
  reset.title = t("settings.resetOne", { value: defaultLabel(def) });
  reset.setAttribute("aria-label", t("settings.resetAria", { label: t(def.label) }));
  reset.append(icon(ICON_RESET));
  reset.addEventListener("click", () => {
    void setSetting(key, def.default);
    control.focus();
  });
  wrap.append(reset);

  row.append(label, wrap);
  controls.set(key, control);
  resetButtons.set(key, reset);
  return row;
}

function build(): void {
  controls.clear();
  resetButtons.clear();
  tabs.clear();
  panels.clear();

  const tablist = document.createElement("div");
  tablist.id = "settings-tabs";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-orientation", "vertical");
  tablist.setAttribute("aria-label", t("settings.tabs"));
  const panelBox = document.createElement("div");
  panelBox.id = "settings-panels";

  for (const { id, label } of SETTING_CATEGORIES) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `settings-tab-${id}`;
    tab.className = "settings-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `settings-panel-${id}`);
    tab.textContent = t(label);
    tab.addEventListener("click", () => selectTab(id));
    tablist.append(tab);
    tabs.set(id, tab);

    const panel = document.createElement("section");
    panel.id = `settings-panel-${id}`;
    panel.className = "settings-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    for (const key of SETTING_KEYS) {
      const def: SettingDef = SETTINGS[key];
      if (def.section !== id) continue;
      panel.append(buildRow(key, def));
      for (const extra of extras) if (extra.category === id && extra.after === key) panel.append(extra.element);
    }
    for (const extra of extras) if (extra.category === id && !extra.after) panel.append(extra.element);
    panelBox.append(panel);
    panels.set(id, panel);
  }

  // ↑↓ (and ←→ when the tabs run across a narrow popup), Home, End: move and open at once
  tablist.addEventListener("keydown", (event) => {
    const order = visibleCategories();
    const at = order.indexOf(selected);
    let next: CategoryId | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = order[(at + 1) % order.length];
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = order[(at - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabs.get(next)!.focus();
  });

  body.replaceChildren(tablist, panelBox);
  for (const key of SETTING_KEYS) sync(key);
}

/** A tab with neither items nor panels is hidden. */
function visibleCategories(): CategoryId[] {
  return SETTING_CATEGORIES.map((c) => c.id).filter((id) => panels.get(id)!.childElementCount > 0);
}

function selectTab(id: CategoryId): void {
  const shownTabs = visibleCategories();
  selected = shownTabs.includes(id) ? id : shownTabs[0];
  for (const [category, tab] of tabs) {
    const on = category === selected;
    tab.hidden = !shownTabs.includes(category);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panels.get(category)!.hidden = !on;
  }
  writePref("settingsTab", selected);
}

/** Brings a control to the current value; changes from outside the popup (Ctrl+Shift+D, the pin) follow. */
function sync(key: SettingKey): void {
  const control = controls.get(key);
  if (!control) return;
  const def: SettingDef = SETTINGS[key];
  if (def.kind === "toggle") (control as HTMLInputElement).checked = getSetting(key) === true;
  // A field being typed in keeps its text until the value is taken
  else if (document.activeElement !== control || control instanceof HTMLSelectElement) control.value = shown(key);
  resetButtons.get(key)!.hidden = isDefault(key);
}

export interface SettingsDialog {
  /** Opens on `category`, or on the tab seen last. */
  open(category?: CategoryId): void;
  isOpen(): boolean;
  /** UI the schema cannot draw, at the end of a tab or right after one of its items. */
  addPanel(category: CategoryId, element: HTMLElement, after?: SettingKey): void;
  /** Runs each time the popup opens (to read state that may have changed). */
  onOpen(hook: () => void): void;
  /** Rebuilds the texts after a language change; the chosen tab and the panels stay. */
  relabel(): void;
}

export function initSettingsDialog(): SettingsDialog {
  build();
  onSettingsChange((changed) => changed.forEach(sync));
  const saved = readPref("settingsTab", SETTING_CATEGORIES[0].id as string, isString);
  selectTab(SETTING_CATEGORIES.some((c) => c.id === saved) ? (saved as CategoryId) : SETTING_CATEGORIES[0].id);

  dialog.querySelector("#settings-reset")!.addEventListener("click", () => void resetSettings());
  // An outside press (on the backdrop) closes
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    open(category) {
      if (category) selectTab(category);
      for (const hook of openHooks) hook();
      if (!dialog.open) dialog.showModal();
      tabs.get(selected)!.focus();
    },
    isOpen: () => dialog.open,
    addPanel(category, element, after) {
      extras.push({ category, element, after });
      const panel = panels.get(category)!;
      const anchor = after ? controls.get(after)?.closest(".setting-row") : null;
      // After the item and any panel already placed after it
      let place: Element | null | undefined = anchor;
      while (place?.nextElementSibling && !place.nextElementSibling.classList.contains("setting-row")) place = place.nextElementSibling;
      if (place) place.after(element);
      else panel.append(element);
      selectTab(selected);
    },
    onOpen(hook) {
      openHooks.push(hook);
    },
    relabel() {
      build();
      selectTab(selected);
    },
  };
}
