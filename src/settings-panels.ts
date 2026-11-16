/**
 * Parts of the settings popup the schema in settings.ts cannot draw: Start with Windows (the
 * Windows Run key, not a widget.json value), where the core was found and the state folder, the
 * branch view location (read-only, the core's setting) and the About facts. Static texts carry
 * data-t keys so a language change relabels them; each panel reads its state again on `refresh()`,
 * which runs when the popup opens.
 */

import { call } from "./backend";
import { t } from "./i18n";
import type { AppInfo, CoreLocation, Dashboard } from "./types";

export interface Panel {
  element: HTMLElement;
  refresh(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", key = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (key) {
    node.dataset.t = key;
    node.textContent = t(key);
  }
  return node;
}

function setKey(node: HTMLElement, key: string, params: Record<string, string | number> = {}): void {
  // Texts with values are written here; data-t would overwrite them with the bare key text
  delete node.dataset.t;
  node.textContent = t(key, params);
}

function folderButton(path: () => string, onError: (text: string) => void): HTMLButtonElement {
  const button = el("button", "link-btn", "settings.openFolder");
  button.type = "button";
  button.addEventListener("click", () => {
    const target = path();
    if (target) void call("open_folder", { path: target }).catch(() => onError(t("toast.notFound")));
  });
  return button;
}

/** Start with Windows: the Run key of this exe. A development build cannot register itself. */
export function autostartPanel(info: () => AppInfo | null, onError: (text: string) => void): Panel {
  const row = el("div", "setting-row");
  const label = el("label");
  label.htmlFor = "setting-autostart";
  const name = el("span", "setting-label", "settings.autostart");
  const hint = el("span", "setting-hint", "settings.autostart.hint");
  hint.id = "setting-autostart-hint";
  label.append(name, hint);
  const box = el("input", "switch");
  box.type = "checkbox";
  box.id = "setting-autostart";
  box.setAttribute("role", "switch");
  box.setAttribute("aria-describedby", hint.id);
  const wrap = el("div", "setting-control");
  // Same column as the schema rows, which end with a reset button
  const spacer = el("span", "setting-reset-space");
  wrap.append(box, spacer);
  row.append(label, wrap);

  box.addEventListener("change", async () => {
    const want = box.checked;
    box.disabled = true;
    try {
      await call(want ? "enable_autostart" : "disable_autostart");
    } catch (e) {
      box.checked = !want;
      onError(t("settings.autostartFailed", { text: String(e) }));
    } finally {
      box.disabled = info()?.dev ?? false;
    }
  });

  return {
    element: row,
    refresh() {
      const dev = info()?.dev ?? false;
      box.disabled = dev;
      hint.dataset.t = dev ? "settings.autostartDev" : "settings.autostart.hint";
      hint.textContent = t(hint.dataset.t);
      void call<boolean>("is_autostart_enabled")
        .then((on) => (box.checked = on === true))
        .catch(() => (box.checked = false));
    },
  };
}

/** Under the script setting: the script in use and how it was found, and the state folder. */
export function corePanel(onError: (text: string) => void): Panel {
  const box = el("div", "setting-facts");
  const detected = el("p", "setting-hint");
  const homeLine = el("p", "setting-hint");
  const home = el("span", "setting-path");
  let homePath = "";
  homeLine.append(home, " ", folderButton(() => homePath, onError));
  box.append(detected, homeLine);
  return {
    element: box,
    refresh() {
      void call<CoreLocation>("get_core_location")
        .then((loc) => {
          if (loc.script) setKey(detected, "settings.detected", { script: loc.script, source: t(`settings.source.${loc.source}`) });
          else setKey(detected, "settings.detectedNone");
          homePath = loc.slotHome;
          setKey(home, "settings.slotHome", { path: loc.slotHome });
        })
        .catch(() => setKey(detected, "settings.detectedNone"));
    },
  };
}

interface BranchViewEntry {
  project?: string | null;
  repo?: string | null;
  path?: string | null;
}

/** Branch view: where the core keeps the view repositories (core 0.7.0 `branchViews[]`), read-only. */
export function branchViewPanel(doc: () => Dashboard | null): Panel {
  const box = el("div", "setting-facts");
  const title = el("p", "setting-label", "settings.branchView.location");
  const text = el("p", "setting-hint");
  const list = el("ul", "setting-list");
  box.append(title, text, list);
  return {
    element: box,
    refresh() {
      const d = doc();
      const views = (d as { branchViews?: BranchViewEntry[] | null } | null)?.branchViews;
      list.replaceChildren();
      if (!d) setKey(text, "settings.branchView.unknown");
      else if (!("branchViews" in d)) setKey(text, "settings.branchView.oldCore", { version: d.version ?? "?" });
      else if (!views?.length) setKey(text, "settings.branchView.none");
      else {
        text.textContent = "";
        for (const v of views) {
          const item = el("li", "setting-path");
          item.textContent = `${v.repo ?? v.project ?? "?"}  ${v.path ?? ""}`;
          list.append(item);
        }
      }
    },
  };
}

/** About: app and core versions, the settings file (shared with agents) and the license. */
export function aboutPanel(info: () => AppInfo | null, doc: () => Dashboard | null, onError: (text: string) => void): Panel {
  const facts = el("dl", "setting-facts about-facts");
  const add = (key: string, value: Node) => {
    const dd = el("dd");
    dd.append(value);
    facts.append(el("dt", "", key), dd);
  };
  const version = el("span");
  const core = el("span");
  const file = el("span", "setting-path");
  const fileBox = el("span");
  fileBox.append(file, " ", folderButton(() => info()?.slotHome ?? "", onError));
  add("settings.appVersion", version);
  add("settings.coreVersion", core);
  add("settings.settingsFile", fileBox);
  add("settings.license", el("span", "", "settings.licenseLine"));
  return {
    element: facts,
    refresh() {
      const i = info();
      if (i) setKey(version, i.dev ? "settings.devBuild" : "settings.appVersionLine", { version: i.version });
      file.textContent = i?.settingsFile ?? "";
      const d = doc();
      if (d?.version) setKey(core, "settings.coreLine", { version: d.version, schema: d.schema });
      else setKey(core, "settings.coreUnknown");
    },
  };
}
