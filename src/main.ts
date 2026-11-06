/**
 * Widget window. Read-only: it shows what `unity-slot dashboard -Json` reports and never opens,
 * closes or leases a slot.
 *
 * Refresh rhythm
 * - full check (`dashboard -Json -Git basic`): every `idleSecs`, every `startingSecs` while an
 *   editor is starting (for up to five minutes), and one second after a quick change signal;
 * - detailed git (`-Git full`): every `gitFullMins`, and when a row is opened for the first time;
 * - quick change signal: signals.rs, every `signalSecs` (Unity.exe ids + slot files);
 * - nothing while the widget is hidden.
 */

import { call, inTauri, isWindowVisible, on } from "./backend";
import { setGlassBlur, setGlassClass, onGlassFrame, type GlassFrame } from "./glass";
import { currentLang, formatClock, formatDuration, formatWhen, resolveLang, setLang, t } from "./i18n";
import { icon } from "./icons";
import { cleanupRequest, elapsedSince, isOpen, mergeGit, nowFor, warnings } from "./model";
import type { Dashboard, DashboardResult, GitState, Slot, WidgetSettings } from "./types";
import { SUPPORTED_SCHEMA_MAJOR } from "./types";
import { esc, eventsPanel, headerPills, slotList, warningBand } from "./view";

const STARTING_CAP_MS = 5 * 60_000;
const MAX_HEIGHT = 600;

let settings: WidgetSettings;
let doc: Dashboard | null = null;
let receivedAt = 0;
let lastResult: DashboardResult | null = null;
let lastError: string | null = null;
const fullGit = new Map<string, GitState>();
let lastFullAt = 0;

const expanded = new Set<string>();
let showAllWarnings = false;
let showEvents = false;

let running = false;
let pending: { full: boolean } | null = null;
let timer: number | undefined;
let nextAt = 0;
let paused = false;
let signalTimer: number | undefined;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function gitOf(slot: Slot): GitState | null {
  return mergeGit(slot.git, fullGit.get(slot.name));
}

function now(): Date {
  return nowFor(doc, receivedAt);
}

// ---------------------------------------------------------------- refresh

function anyStarting(): boolean {
  const n = now();
  return (doc?.slots ?? []).some((s) => {
    if (s.editor?.state !== "starting") return false;
    const ms = elapsedSince(s.editor.startedAt, n);
    return ms === null || ms < STARTING_CAP_MS;
  });
}

function schedule() {
  window.clearTimeout(timer);
  const secs = anyStarting() ? settings.startingSecs : settings.idleSecs;
  nextAt = Date.now() + secs * 1000;
  timer = window.setTimeout(() => void refresh(false), secs * 1000);
}

const visible = isWindowVisible;

function schemaMajor(schema: string | undefined): number | null {
  const m = /\/(\d+)/.exec(schema ?? "");
  return m ? Number(m[1]) : null;
}

async function refresh(forceFull: boolean) {
  if (running) {
    pending = { full: (pending?.full ?? false) || forceFull };
    return;
  }
  if (!(await visible())) {
    paused = true;
    renderFooter();
    schedule();
    return;
  }
  paused = false;
  running = true;
  $("busy").classList.remove("hidden");
  const full = forceFull || lastFullAt === 0 || Date.now() - lastFullAt >= settings.gitFullMins * 60_000;
  try {
    const result = await call<DashboardResult>("get_dashboard", { git: full ? "full" : "basic" });
    const major = schemaMajor(result.document.schema);
    if (major !== SUPPORTED_SCHEMA_MAJOR) {
      throw `schema:${result.document.schema}`;
    }
    lastResult = result;
    doc = result.document;
    receivedAt = Date.now();
    lastError = null;
    if (full) {
      lastFullAt = Date.now();
      fullGit.clear();
      for (const s of doc.slots ?? []) if (s.git?.level === "full") fullGit.set(s.name, s.git);
    }
  } catch (e) {
    const code = String(e);
    if (code !== "busy") lastError = code;
  } finally {
    running = false;
    $("busy").classList.add("hidden");
  }
  render();
  schedule();
  if (pending) {
    const next = pending;
    pending = null;
    void refresh(next.full);
  }
}

function onSignal() {
  window.clearTimeout(signalTimer);
  signalTimer = window.setTimeout(() => void refresh(false), 1000);
}

// ---------------------------------------------------------------- render

function errorText(code: string): string {
  const [kind, ...rest] = code.split(":");
  const text = rest.join(":");
  switch (kind) {
    case "core-not-found":
      return t("error.core-not-found");
    case "timeout":
      return t("error.timeout");
    case "exit":
      return t("error.exit", { text: rest.slice(1).join(":") || text });
    case "parse":
      return t("error.parse");
    case "schema":
      return t("error.schema", { want: `unity-slot.dashboard/${SUPPORTED_SCHEMA_MAJOR}`, got: text || "?" });
    case "sample":
      return t("error.sample", { text });
    case "spawn":
      return t("error.spawn", { text });
    default:
      return t("error.unknown", { text: code });
  }
}

function render() {
  const n = now();
  const slots = doc?.slots ?? [];
  // Every open editor counts against maxEditors, registered or not.
  const open = doc?.system?.editorsOpen ?? slots.filter(isOpen).length;
  const max = doc?.registry?.maxEditors ?? slots.length;
  const percent = doc?.system?.commit?.percent;
  $("summary").innerHTML = doc ? headerPills(open, max, percent, settings) : "";

  const bands: string[] = [];
  if (lastError) {
    bands.push(
      `<div class="band error">${icon("alert", 12)}<span>${esc(errorText(lastError))}${
        doc ? ` <span class="muted">${esc(t("error.keepLast"))}</span>` : ""
      }</span></div>`,
    );
  }
  if (doc) bands.push(warningBand(warnings(doc, settings, n, gitOf), showAllWarnings));
  $("bands").innerHTML = bands.join("");

  if (doc) {
    $("list-inner").innerHTML =
      slotList(doc, { now: n, settings, expanded, gitOf }) + (showEvents ? eventsPanel(doc.recentEvents ?? [], n) : "");
  } else if (!lastError) {
    $("list-inner").innerHTML = `<p class="empty muted">${esc(t("footer.loading"))}</p>`;
  } else {
    $("list-inner").innerHTML = "";
  }
  renderFooter();
  updateFade();
  // The height follows a ResizeObserver on the content (see boot), so fonts and opened
  // cards are covered too.
}

/** Like the other widgets: no scrollbar, a soft fade at whichever end has more rows. */
function updateFade() {
  const list = $("list");
  const wrap = $("list-wrap");
  wrap.classList.toggle("fade-top", list.scrollTop > 2);
  wrap.classList.toggle("fade-bottom", list.scrollTop + list.clientHeight < list.scrollHeight - 2);
}

function renderFooter() {
  const left: string[] = [];
  // The time the core produced the document (for a sample, its own time).
  if (receivedAt) left.push(t("footer.updated", { time: formatClock(doc?.time ? new Date(doc.time) : new Date(receivedAt)) }));
  if (paused) left.push(t("footer.paused"));
  else if (nextAt) left.push(t("footer.next", { secs: Math.max(0, Math.round((nextAt - Date.now()) / 1000)) }));
  const fetches = (doc?.slots ?? []).map((s) => s.git?.lastFetchAt).filter((x): x is string => !!x).sort();
  if (fetches.length) left.push(t("footer.fetch", { time: formatWhen(fetches[0], now()) }));

  const right: string[] = [];
  const unreg = doc?.unregisteredEditors?.length ?? 0;
  const orphans = doc?.orphanWorkers?.length ?? 0;
  // Only when there is something to see; both are usually zero.
  if (unreg > 0) right.push(t("footer.unregistered", { n: unreg }));
  if (orphans > 0) right.push(t("footer.orphans", { n: orphans }));
  if (lastResult?.source === "sample") right.push(t("footer.sample"));
  else if (doc?.version) right.push(t("footer.core", { version: doc.version }));
  $("footer-left").textContent = left.join(" · ");
  $("footer-right").textContent = right.join(" · ");
  $("footer-right").classList.toggle("attention", unreg > 0 || orphans > 0);
}

/** Durations and the countdown move every second without redrawing the rows. */
function tick() {
  const n = now();
  document.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    const ms = elapsedSince(el.dataset.since, n);
    if (ms !== null) el.textContent = formatDuration(ms);
  });
  renderFooter();
}

let lastHeight = 0;
/**
 * Window height = everything but the list + the list content's natural height, capped.
 * The content box (#list-inner) keeps its own height whatever the window is, so this both
 * grows and shrinks the window.
 */
function fitHeight() {
  const widget = document.querySelector<HTMLElement>(".widget");
  if (!widget) return;
  const chrome = widget.offsetHeight - $("list-wrap").offsetHeight;
  const wanted = Math.min(MAX_HEIGHT, Math.ceil(chrome + $("list-inner").offsetHeight));
  if (Math.abs(wanted - lastHeight) < 2) return;
  lastHeight = wanted;
  void call("resize_main_window", { height: wanted }).catch(() => {});
}

// ---------------------------------------------------------------- actions

function toast(text: string) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 2200);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function onListClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]");
  if (action) {
    e.stopPropagation();
    const path = action.dataset.path ?? "";
    switch (action.dataset.action) {
      case "folder":
        await call("open_folder", { path }).catch(() => toast(t("toast.notFound")));
        return;
      case "log":
        await call("open_log", { path }).catch(() => toast(t("toast.notFound")));
        return;
      case "copy":
        if (await copyText(path)) toast(t("toast.copied"));
        return;
    }
  }
  // Clicks inside the open details select text; they do not fold the card.
  if (target.closest(".details")) return;
  const toggle = target.closest<HTMLElement>("[data-toggle]");
  if (toggle?.dataset.toggle) {
    const name = toggle.dataset.toggle;
    if (expanded.has(name)) expanded.delete(name);
    else {
      expanded.add(name);
      // First look at a row: bring the detailed git state if it is old.
      if (Date.now() - lastFullAt > 60_000) void refresh(true);
    }
    render();
  }
}

async function copyCleanup() {
  if (!doc) return;
  const text = cleanupRequest(doc, now(), gitOf);
  if (!text) {
    toast(t("toast.cleanupEmpty"));
    return;
  }
  if (await copyText(text)) toast(t("toast.cleanupCopied"));
}

function showMenu(x: number, y: number) {
  const menu = $("menu");
  $("menu-backdrop").classList.remove("hidden");
  menu.classList.remove("hidden");
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
}

function hideMenu() {
  $("menu").classList.add("hidden");
  $("menu-backdrop").classList.add("hidden");
}

function applyTexts() {
  $("title").textContent = t("app.title");
  $("menu-settings").textContent = t("menu.settings");
  $("menu-refresh").textContent = t("menu.refresh");
  $("menu-cleanup").textContent = t("menu.cleanup");
  $("menu-events").textContent = t("menu.events");
  $("menu-quit").textContent = t("menu.quit");
  void call("set_tray_labels", {
    labels: { show: t("tray.show"), hide: t("tray.hide"), settings: t("tray.settings"), quit: t("tray.quit") },
  }).catch(() => {});
}

async function applySettings(next: WidgetSettings, first: boolean) {
  settings = next;
  const lang = resolveLang(settings.language);
  if (first || lang !== currentLang()) {
    setLang(lang);
    applyTexts();
  }
  try {
    await call("set_always_on_top", { enabled: settings.alwaysOnTop });
    await call("set_glass_blur", { px: settings.glassBlur });
    setGlassClass(await call<boolean>("set_glass", { enabled: settings.glass }));
  } catch {
    /* browser preview */
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  await applySettings(await call<WidgetSettings>("get_settings"), true);
  if (!inTauri) {
    // Browser preview only (README screenshots): ?expand=<slot>[,<slot>]&events=1
    const query = new URLSearchParams(location.search);
    for (const name of (query.get("expand") ?? "").split(",").filter(Boolean)) expanded.add(name);
    showEvents = query.get("events") === "1";
    // ?frame=400x575 draws the widget at that size whatever the browser window is.
    const frame = /^(\d+)x(\d+)$/.exec(query.get("frame") ?? "");
    if (frame) {
      document.body.style.width = `${frame[1]}px`;
      document.body.style.height = `${frame[2]}px`;
    }
  }
  render();

  $("list").addEventListener("click", (e) => void onListClick(e));
  $("list").addEventListener("scroll", updateFade, { passive: true });
  $("bands").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='toggle-warnings']")) {
      showAllWarnings = !showAllWarnings;
      render();
    }
  });
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY);
  });
  $("menu-backdrop").addEventListener("click", hideMenu);
  window.addEventListener("blur", hideMenu);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMenu();
  });
  $("menu-settings").addEventListener("click", () => {
    hideMenu();
    void call("open_settings_window");
  });
  $("menu-refresh").addEventListener("click", () => {
    hideMenu();
    void refresh(true);
  });
  $("menu-cleanup").addEventListener("click", () => {
    hideMenu();
    void copyCleanup();
  });
  $("menu-events").addEventListener("click", () => {
    hideMenu();
    showEvents = !showEvents;
    render();
  });
  $("menu-quit").addEventListener("click", () => void call("quit_app"));

  await on("slot-signal", onSignal);
  await on("widget-shown", () => void refresh(false));
  await on<WidgetSettings>("settings-saved", async (payload) => {
    await applySettings(payload, false);
    render();
    schedule();
  });
  await on<boolean>("glass-applied", (payload) => setGlassClass(payload));
  await on<number>("glass-blur", (payload) => setGlassBlur(payload));
  await on<GlassFrame>("glass-frame", (payload) => onGlassFrame(payload));
  void document.fonts?.ready.then(() => {
    fitHeight();
    updateFade();
  });
  window.addEventListener("resize", updateFade);
  const observer = new ResizeObserver(() => {
    fitHeight();
    updateFade();
  });
  observer.observe($("list-inner"));
  observer.observe($("bands"));

  window.setInterval(tick, 1000);
  void refresh(true);
}

void boot();
