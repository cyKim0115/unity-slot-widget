/**
 * The small widget's page (mini.html; the window is src-tauri/src/mini.rs). It stands in for the
 * main window while the close box is set to 「작은 위젯으로」: only the slots whose editor is open,
 * one row each, under a title line. A row slides in when its editor opens and folds away when it
 * closes; with no editor open the window hides (the title line with it), and it shows again (without taking the focus) when one opens.
 *
 * - Draws at once when the mode starts: the window is made ahead (mini.rs `prepare`) and the last
 *   slot document the app read is drawn first (`mini_cached`), then read again behind it; a
 *   document the main page reads meanwhile arrives as `mini-dashboard`.
 * - Refreshes like the main page, with `-Git basic` only: every `startingSecs` while an editor is
 *   starting, else every `idleSecs`, and at once on a quick signal (signals.rs sends them here while
 *   the mode is on, also while this window is hidden). A read refused because another one runs
 *   (`busy`, the main page's) is tried again after BUSY_RETRY_MS.
 * - Reports the height it needs (`mini_layout`); Rust sizes, places, shows or hides the window and
 *   says which edge it keeps. The rows line up against that edge while they come and go, so the
 *   others stay where they are on screen. The window grows before rows come in and shrinks after
 *   they have gone.
 * - A press brings the main window back with that slot selected; dragging moves the widget.
 *
 * Browser preview: http://localhost:1431/mini.html?sample=dashboard (backend.ts stands in for Rust;
 * the page draws itself 288 px wide). `?only=<slot>,<slot>` lists only those slots, and
 * `miniPreview.only([...])` in the console changes that, to watch rows come and go.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { receiveAliases } from "../aliases";
import { call, inTauri, on } from "../backend";
import { formatDuration, resolveLang, setLang, t } from "../i18n";
import { elapsedSince, nowFor } from "../model";
import { getSettings, receiveSettings } from "../settings";
import { initTheme } from "../shell/theme";
import type { Dashboard, DashboardResult, WidgetSettings } from "../types";
import { checkSchema, errorRow, miniRow, openSlots, rowKey, rowSignature, usableCache, type Cached } from "./rows";

const STARTING_CAP_MS = 5 * 60_000;
const ENTER_MS = 180;
const LEAVE_MS = 200;
const BUSY_RETRY_MS = 1000;
/** Width the preview draws (src-tauri/src/mini.rs WIDTH: the card and its margin). */
const PREVIEW_WIDTH = 304;

interface Placement {
  shown: boolean;
  anchor: "top" | "bottom";
}

const card = document.getElementById("mini-card") as HTMLDivElement;
const list = document.getElementById("mini-list") as HTMLUListElement;
const title = document.getElementById("mini-title") as HTMLSpanElement;
const theme = initTheme();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

let active = false;
let doc: Dashboard | null = null;
let receivedAt = 0;
let failed = false;
/** The last read was refused because another one ran: try again soon. */
let busy = false;
let running = false;
let again = false;
let timer: number | undefined;
let signalTimer: number | undefined;
/** The window is on screen, at this height (logical px). */
let shown = false;
let height = 0;
/** Rows on screen by key; a row that is leaving is no longer here. */
const rows = new Map<string, HTMLElement>();
const signatures = new WeakMap<HTMLElement, string>();
/** One update at a time (an animation may still be playing when the next refresh lands). */
let queue: Promise<void> = Promise.resolve();
/** Browser preview: only these slots (null: all). */
let previewOnly: Set<string> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const motion = () => !reduced.matches && !document.hidden;

// ---------------------------------------------------------------- settings

function applySettings() {
  const s = getSettings();
  setLang(resolveLang(s.language));
  theme.apply(s.theme, s.themeDurationMs);
  title.textContent = t("mini.title");
  list.setAttribute("aria-label", t("mini.label"));
  document.title = t("mini.label");
  document.body.title = t("mini.hint");
}

async function reloadSettings() {
  const [settings, aliases] = await Promise.all([
    call<WidgetSettings>("get_settings").catch(() => null),
    call<Record<string, string>>("get_project_aliases").catch(() => null),
  ]);
  receiveSettings(settings);
  receiveAliases(aliases);
  applySettings();
}

// ---------------------------------------------------------------- refresh

function anyStarting(): boolean {
  const now = nowFor(doc, receivedAt);
  return (doc?.slots ?? []).some((s) => {
    if (s.editor?.state !== "starting") return false;
    const ms = elapsedSince(s.editor.startedAt, now);
    return ms === null || ms < STARTING_CAP_MS;
  });
}

function schedule() {
  window.clearTimeout(timer);
  if (!active) return;
  const s = getSettings();
  const ms = busy ? BUSY_RETRY_MS : (anyStarting() ? s.startingSecs : s.idleSecs) * 1000;
  timer = window.setTimeout(() => void refresh(), ms);
}

async function refresh() {
  if (!active) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const result = await call<DashboardResult>("get_dashboard", { git: "basic" });
    checkSchema(result.document);
    doc = result.document;
    receivedAt = Date.now();
    failed = false;
    busy = false;
  } catch (e) {
    busy = String(e) === "busy";
    if (!busy) failed = true;
  } finally {
    running = false;
  }
  if (!active) return;
  update();
  schedule();
  if (again) {
    again = false;
    void refresh();
  }
}

function onSignal() {
  window.clearTimeout(signalTimer);
  signalTimer = window.setTimeout(() => void refresh(), 500);
}

/** Takes a remembered document when it is newer than the one on screen; true when taken. */
function takeCached(cached: Cached | null): boolean {
  const use = usableCache(cached, Date.now(), doc ? receivedAt : 0);
  if (!use) return false;
  doc = use.result.document;
  receivedAt = use.receivedAt;
  failed = false;
  return true;
}

/**
 * The mode began (or the page loaded into it): the settings and the last document the app read
 * together, draw that at once, then read the slots again.
 */
async function start() {
  if (active) return;
  active = true;
  const [settings, aliases, cached] = await Promise.all([
    call<WidgetSettings>("get_settings").catch(() => null),
    call<Record<string, string>>("get_project_aliases").catch(() => null),
    call<Cached | null>("mini_cached").catch(() => null),
  ]);
  if (!active) return;
  receiveSettings(settings);
  receiveAliases(aliases);
  applySettings();
  if (takeCached(cached)) update();
  void refresh();
}

/** A document another page read while the mode is on (the main page's last refresh). */
function onDashboard(cached: Cached) {
  if (!active || !takeCached(cached)) return;
  busy = false;
  update();
  schedule();
}

/** The main window is back: Rust has hidden the window; forget the rows so the next start begins clean. */
function stop() {
  active = false;
  window.clearTimeout(timer);
  window.clearTimeout(signalTimer);
  doc = null;
  failed = false;
  busy = false;
  shown = false;
  height = 0;
  rows.clear();
  list.replaceChildren();
}

// ---------------------------------------------------------------- drawing

function fromHtml(html: string): HTMLElement {
  const box = document.createElement("template");
  box.innerHTML = html.trim();
  return box.content.firstElementChild as HTMLElement;
}

/** The rows that should be on screen now: key and HTML, in order. */
function wanted(): Array<{ key: string; html: string }> {
  if (!doc) return failed ? [{ key: "error", html: errorRow() }] : [];
  const now = nowFor(doc, receivedAt);
  const settings = getSettings();
  return openSlots(doc)
    .filter((s) => !previewOnly || previewOnly.has(s.name))
    .map((s) => ({ key: rowKey(s), html: miniRow(s, now, settings) }));
}

/**
 * Brings the list to what `wanted` says without moving rows that stay: new rows go in (hidden until
 * they fade in), changed rows are drawn again, rows that went are marked as leaving and stay in
 * place until they have folded away.
 */
function apply(): { entering: HTMLElement[]; leaving: HTMLElement[] } {
  const want = wanted();
  const keys = new Set(want.map((w) => w.key));
  const leaving: HTMLElement[] = [];
  for (const [key, el] of rows) {
    if (keys.has(key)) continue;
    rows.delete(key);
    el.classList.add("leaving");
    leaving.push(el);
  }
  const entering: HTMLElement[] = [];
  for (const w of want) {
    const old = rows.get(w.key);
    const sig = rowSignature(w.html);
    if (old && signatures.get(old) === sig) continue;
    const el = fromHtml(w.html);
    signatures.set(el, sig);
    if (old) old.replaceWith(el);
    else {
      if (shown && motion()) el.classList.add("entering");
      list.append(el);
      entering.push(el);
    }
    rows.set(w.key, el);
  }
  // Row order (leaving rows keep their place among the others); move only when it changed
  const children = Array.from(list.children) as HTMLElement[];
  const sorted = [...children].sort((a, b) => {
    const x = a.dataset.sort ?? "";
    const y = b.dataset.sort ?? "";
    return x < y ? -1 : x > y ? 1 : 0;
  });
  if (sorted.some((el, i) => el !== children[i])) list.append(...sorted);
  document.body.classList.toggle("stale", failed && doc !== null);
  document.body.title = failed && doc ? t("mini.stale") : t("mini.hint");
  return { entering, leaving };
}

/** Rows come in. Not skipped for a window that was just shown and may not count as visible yet: its animations start once it does. */
function fadeIn(els: HTMLElement[]) {
  for (const el of els) {
    el.classList.remove("entering");
    if (reduced.matches) continue;
    el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], {
      duration: ENTER_MS,
      easing: "ease-out",
    });
  }
}

/** Folds the rows away. A timer ends the wait too: a covered window may not run animations. */
async function foldAway(els: HTMLElement[]) {
  if (!els.length) return;
  if (motion()) {
    const runs = els.map((el) =>
      el.animate([{ opacity: 1, height: `${el.offsetHeight}px` }, { opacity: 0, height: "0px" }], {
        duration: LEAVE_MS,
        easing: "ease-in",
        fill: "forwards",
      }),
    );
    await Promise.race([Promise.all(runs.map((r) => r.finished.catch(() => undefined))), sleep(LEAVE_MS + 150)]);
  }
  for (const el of els) el.remove();
}

/** Asks for the window at `h` logical px (0 hides it). */
async function layout(h: number) {
  let place: Placement | null = null;
  try {
    place = await call<Placement | null>("mini_layout", { height: h });
  } catch {
    place = null;
  }
  shown = place?.shown ?? h > 0;
  height = shown ? h : 0;
  document.body.dataset.anchor = place?.anchor ?? "bottom";
  if (!inTauri) {
    // The preview has no window: draw its frame
    document.documentElement.style.width = `${PREVIEW_WIDTH}px`;
    document.documentElement.style.height = shown ? `${h}px` : "0px";
    document.documentElement.style.visibility = shown ? "visible" : "hidden";
  }
}

async function step() {
  if (!active) return;
  const { entering, leaving } = apply();
  const gone = leaving.reduce((sum, el) => sum + el.offsetHeight, 0);
  // The card and the transparent margin around it (frame.css)
  const margin = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
  const full = Math.ceil(card.getBoundingClientRect().height + 2 * margin);
  const after = full - Math.ceil(gone);
  if (!rows.size) {
    if (shown) await foldAway(leaving);
    else for (const el of leaving) el.remove();
    if (active) await layout(0);
    return;
  }
  const appearing = !shown;
  // Hidden until the window is up, then they fade in (no frame shows them before)
  if (appearing && !reduced.matches) for (const el of rows.values()) el.classList.add("entering");
  // Room first for the rows that come in (the leaving ones still take theirs)
  if (appearing || full > height) await layout(full);
  if (!active) return;
  if (appearing) fadeIn(Array.from(rows.values()));
  else fadeIn(entering);
  await foldAway(leaving);
  if (active && after !== height) await layout(after);
}

function update() {
  queue = queue.then(step).catch(() => undefined);
}

/** Running times, every second while on screen. */
function tick() {
  if (!shown) return;
  const now = nowFor(doc, receivedAt);
  list.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    const ms = elapsedSince(el.dataset.since, now);
    if (ms !== null) el.textContent = formatDuration(ms);
  });
}

// ---------------------------------------------------------------- press and drag

/** A press without moving opens the main window; moving a few pixels drags the widget instead. */
function bindPointer() {
  let press: { x: number; y: number } | null = null;
  document.addEventListener("mousedown", (e) => {
    press = e.button === 0 ? { x: e.screenX, y: e.screenY } : null;
  });
  document.addEventListener("mousemove", (e) => {
    if (!press) return;
    if (!(e.buttons & 1)) {
      press = null;
      return;
    }
    if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) < 4) return;
    press = null;
    if (inTauri) void getCurrentWindow().startDragging();
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !press) return;
    press = null;
    // The margin around the card (its shadow) only drags
    if (!card.contains(e.target as Node)) return;
    const slot = (e.target as Element).closest<HTMLElement>("[data-slot]")?.dataset.slot ?? null;
    void call("mini_open_main", { slot });
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---------------------------------------------------------------- boot

async function boot() {
  bindPointer();
  if (!inTauri) {
    const only = new URLSearchParams(location.search).get("only");
    if (only) previewOnly = new Set(only.split(",").filter(Boolean));
    (window as unknown as { miniPreview: unknown }).miniPreview = {
      only(names: string[] | null) {
        previewOnly = names ? new Set(names) : null;
        update();
      },
    };
  }
  await on<boolean>("mini-mode", (on) => (on ? void start() : stop()));
  await on("slot-signal", onSignal);
  await on<Cached>("mini-dashboard", onDashboard);
  // widget.json changed: language, theme, nicknames, intervals, a sample file; read the slots again too
  await on("settings-file-changed", () => void reloadSettings().then(() => refresh()));
  window.setInterval(tick, 1000);
  if (await call<boolean>("mini_active").catch(() => false)) await start();
}

void boot();
