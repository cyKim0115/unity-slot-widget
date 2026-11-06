import { call, on } from "./backend";
import { resolveLang, setLang, t } from "./i18n";
import type { CoreLocation, WidgetSettings } from "./types";

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

function applyTexts() {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t ?? "");
  });
  document.title = t("settings.title");
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
  (document.getElementById("language") as HTMLSelectElement).value = s.language;
  for (const key of BOOL_FIELDS) input(key).checked = s[key];
  for (const key of NUMBER_FIELDS) input(key).value = String(s[key]);
  for (const key of TEXT_FIELDS) input(key).value = s[key];
  input("glassBlur").value = String(s.glassBlur);
}

function read(): WidgetSettings {
  const s: WidgetSettings = { ...loaded };
  s.language = (document.getElementById("language") as HTMLSelectElement).value as WidgetSettings["language"];
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

async function boot() {
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
  document.getElementById("cancel")!.addEventListener("click", () => {
    fill(loaded);
    void call("close_settings_window");
  });
  await on("settings-open", () => void load());
  await on("settings-cancelled", () => fill(loaded));
  await load();
}

void boot();
