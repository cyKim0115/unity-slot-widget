import { getCurrentWindow } from "@tauri-apps/api/window";
import { call, inTauri, on } from "./backend";
import { resolveLang, setLang, t } from "./i18n";
import { OPEN_TARGETS, type CoreLocation, type OpenTarget, type WidgetSettings } from "./types";

const NUMBER_FIELDS = [
  "idleSecs",
  "startingSecs",
  "gitFullMins",
  "signalSecs",
  "commitWarnPercent",
  "commitCriticalPercent",
  "slotMemoryWarnGb",
  "localOnlyWarnDays",
  "localOnlyCriticalDays",
] as const;
const TEXT_FIELDS = ["unitySlotScript", "sampleFile"] as const;
const BOOL_FIELDS = ["alwaysOnTop", "glass"] as const;

let loaded: WidgetSettings;

function input(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function select(id: string): HTMLSelectElement {
  return document.getElementById(id) as HTMLSelectElement;
}

function applyTexts() {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t ?? "");
  });
  document.title = t("settings.title");
  const close = document.getElementById("titlebar-close")!;
  close.title = t("settings.close");
  close.setAttribute("aria-label", t("settings.close"));
  updateBlurLabel();
}

function updateBlurLabel() {
  document.getElementById("glassBlurLabel")!.textContent = t("settings.glassBlur", { px: input("glassBlur").value });
}

async function showLocation() {
  try {
    const loc = await call<CoreLocation>("get_core_location");
    document.getElementById("detected")!.textContent = loc.script
      ? t("settings.detected", { script: loc.script, source: t(`settings.source.${loc.source}`) })
      : t("settings.detectedNone");
    document.getElementById("slotHome")!.textContent = t("settings.slotHome", { path: loc.slotHome });
  } catch {
    /* browser preview */
  }
}

function fill(s: WidgetSettings) {
  select("language").value = s.language;
  select("openTarget").value = s.openTarget;
  for (const key of BOOL_FIELDS) input(key).checked = s[key];
  for (const key of NUMBER_FIELDS) input(key).value = String(s[key]);
  for (const key of TEXT_FIELDS) input(key).value = s[key];
  input("glassBlur").value = String(s.glassBlur);
}

function read(): WidgetSettings {
  const s: WidgetSettings = { ...loaded };
  s.language = select("language").value as WidgetSettings["language"];
  const target = select("openTarget").value as OpenTarget;
  if (OPEN_TARGETS.includes(target)) s.openTarget = target;
  for (const key of BOOL_FIELDS) s[key] = input(key).checked;
  for (const key of NUMBER_FIELDS) {
    const v = Number(input(key).value);
    if (Number.isFinite(v)) s[key] = v;
  }
  for (const key of TEXT_FIELDS) s[key] = input(key).value.trim();
  s.glassBlur = Number(input("glassBlur").value);
  return s;
}

async function load() {
  loaded = await call<WidgetSettings>("get_settings");
  setLang(resolveLang(loaded.language));
  fill(loaded);
  applyTexts();
  await showLocation();

  const dev = await call<boolean>("is_dev_build").catch(() => false);
  const autostart = input("autostart");
  autostart.disabled = dev;
  document.getElementById("autostart-hint")!.classList.toggle("hidden", !dev);
  autostart.checked = await call<boolean>("is_autostart_enabled").catch(() => false);

  const glassOk = await call<boolean>("glass_supported").catch(() => false);
  input("glass").disabled = !glassOk;
  document.getElementById("glass-hint")!.classList.toggle("hidden", glassOk);
}

async function save() {
  const saved = await call<WidgetSettings>("save_settings", { settings: read() });
  loaded = saved;
  setLang(resolveLang(saved.language));
  applyTexts();
  await call("close_settings_window");
}

/** Cancel: put the last saved values back and hide the window. */
function cancel() {
  if (loaded) fill(loaded);
  void call("close_settings_window");
}

/**
 * Title bar. The settings window has no OS title bar (tauri.conf.json decorations: false), like
 * Frond's settings dialog: a small title and a close X on the same background. X and Esc cancel.
 * Dragging is handled here instead of data-tauri-drag-region, which maximizes on a double click
 * and only drags from the exact element that carries it. Wired before any await so a failed load
 * can still be closed.
 */
function initTitlebar() {
  document.getElementById("titlebar-close")!.addEventListener("click", cancel);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancel();
  });
  document.querySelector(".settings-titlebar")!.addEventListener("mousedown", (event) => {
    const e = event as MouseEvent;
    if (e.button !== 0 || e.detail > 1 || !inTauri) return;
    if ((e.target as Element).closest("button, a, input, select")) return;
    e.preventDefault();
    void getCurrentWindow().startDragging().catch(() => {});
  });
}

async function boot() {
  initTitlebar();
  input("glassBlur").addEventListener("input", updateBlurLabel);
  input("autostart").addEventListener("change", async () => {
    const box = input("autostart");
    box.disabled = true;
    try {
      await call(box.checked ? "enable_autostart" : "disable_autostart");
    } catch {
      box.checked = !box.checked;
    } finally {
      box.disabled = false;
    }
  });
  document.getElementById("save")!.addEventListener("click", () => void save());
  document.getElementById("cancel")!.addEventListener("click", cancel);
  await on("settings-open", () => void load());
  await on("settings-cancelled", () => fill(loaded));
  await load();
}

void boot();
