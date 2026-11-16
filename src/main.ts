/**
 * Main window. It shows what `unity-slot dashboard -Json` reports and never closes or leases a
 * slot. The frame follows the author's Frond app (src/shell): title bar strips, a side panel with
 * square tabs (projects, warnings, recent events), the slot list in the free width, the selected
 * slot's details on the right, a banner for what needs a person now, and a status bar whose items
 * can be pressed. Notices show in the status bar for a moment (flashStatus) instead of toasts.
 *
 * A slot row's right-click menu and the details buttons:
 * - Open in Unity: `unity-slot open <slot> -NoWait` through the core, which makes the checks and
 *   starts the editor (the app never runs Unity.exe itself). Off for a leased, missing or
 *   batchmode slot; on an open slot it becomes Show Unity window (brings it to the front).
 *   There is no shortcut for it: starting an editor by accident costs a lot of memory.
 * - Open: the folder in another program (Fork by default). Show in Explorer. Log. Copy path.
 *
 * Refresh rhythm
 * - full check (`dashboard -Json -Git basic`): every `idleSecs`, every `startingSecs` while an
 *   editor is starting (for up to five minutes), and one second after a quick change signal;
 * - detailed git (`-Git full`): every `gitFullMins`, and when a slot is selected and the last one is
 *   older than a minute;
 * - quick change signal: signals.rs, every `signalSecs` (Unity.exe ids + slot files);
 * - nothing while the window is hidden.
 */

import { call, inTauri, isWindowVisible, on } from "./backend";
import { applyDomTexts, currentLang, formatClock, formatDuration, formatGb, formatWhen, resolveLang, setLang, t } from "./i18n";
import { cleanupRequest, elapsedSince, isOpen, mergeGit, nowFor, warnings, type Warning } from "./model";
import { bodyMessage, logPanel, projectsPanel, slotBody, warningsPanel, type UnityButton } from "./panels";
import { relabelBanner, setBannerFocusHome, showBanner, type BannerState } from "./shell/banner";
import { hideContextMenu, isContextMenuOpen, showContextMenu, showMenuAbove, showMenuBelow, type MenuEntry } from "./shell/context-menu";
import { showDialog } from "./shell/dialog";
import { initKeys } from "./shell/keys";
import { initNav } from "./shell/nav";
import { isString, readPref, writePref } from "./shell/prefs";
import { initBodyResize } from "./shell/resize";
import { fitStatusbar, flashStatus, setStatusPath } from "./shell/statusbar";
import { initSettingsDialog } from "./shell/settings-dialog";
import { initTheme, oppositeChoice } from "./shell/theme";
import { initTitlebar } from "./shell/titlebar";
import {
  type CategoryId,
  getSettings,
  onSettingsChange,
  onSettingsSaveError,
  patchSettings,
  receiveSettings,
  SETTING_KEYS,
  type SettingKey,
} from "./settings";
import { aboutPanel, autostartPanel, branchViewPanel, corePanel } from "./settings-panels";
import type { AppInfo, Dashboard, DashboardResult, GitState, OpenResult, OpenTarget, Slot, WidgetSettings } from "./types";
import { SUPPORTED_SCHEMA_MAJOR } from "./types";
import { esc, slotList, type RowContext } from "./view";

const STARTING_CAP_MS = 5 * 60_000;
const FIRST_LOOK_FULL_MS = 60_000;

type SlotFilter = "all" | "open" | "attention";
const isFilter = (v: unknown): v is SlotFilter => v === "all" || v === "open" || v === "attention";
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** The settings in effect (src/settings.ts keeps them; this is its latest copy). */
let settings: WidgetSettings = getSettings();
let appInfo: AppInfo | null = null;
let doc: Dashboard | null = null;
let receivedAt = 0;
let lastResult: DashboardResult | null = null;
let lastError: string | null = null;
const fullGit = new Map<string, GitState>();
let lastFullAt = 0;

let running = false;
let pending: { full: boolean } | null = null;
let timer: number | undefined;
let nextAt = 0;
let paused = false;
let signalTimer: number | undefined;

/** Screen state, kept per PC in localStorage (shell/prefs). */
let selected: string | null = readPref("selected", null, isStringOrNull);
let filter: SlotFilter = readPref("slotFilter", "all", isFilter);
let bodyOpen = readPref("bodyOpen", true, (v): v is boolean => typeof v === "boolean");
let view = readPref("view", "slots", isString);
let findText = "";
/** The selected row's details open under it (when the details column is not on screen). */
let inlineOpen = false;
/** Scroll the selected row into view after the next list paint. */
let revealSelection = false;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const app = $("app");
/** Below 1000px the side panel opens over the list; below 720px the details column hides. */
const overlayQuery = matchMedia("(max-width: 999px)");
const narrowQuery = matchMedia("(max-width: 719px)");

const nav = initNav(overlayQuery);
const titlebar = initTitlebar(inTauri);
const theme = initTheme();
const settingsDialog = initSettingsDialog();

function gitOf(slot: Slot): GitState | null {
  return mergeGit(slot.git, fullGit.get(slot.name));
}

function now(): Date {
  return nowFor(doc, receivedAt);
}

function slots(): Slot[] {
  return doc?.slots ?? [];
}

function selectedSlot(): Slot | null {
  return selected ? (slots().find((s) => s.name === selected) ?? null) : null;
}

/** The details column is on screen (not folded with Ctrl+\ and the window is wide enough). */
function bodyShown(): boolean {
  return bodyOpen && !narrowQuery.matches;
}

function currentWarnings(): Warning[] | null {
  return doc ? warnings(doc, settings, now(), gitOf) : null;
}

// ---------------------------------------------------------------- refresh

function anyStarting(): boolean {
  const n = now();
  return slots().some((s) => {
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

function schemaMajor(schema: string | undefined): number | null {
  const m = /\/(\d+)/.exec(schema ?? "");
  return m ? Number(m[1]) : null;
}

async function refresh(forceFull: boolean) {
  if (running) {
    pending = { full: (pending?.full ?? false) || forceFull };
    return;
  }
  if (!(await isWindowVisible())) {
    paused = true;
    renderStatus();
    schedule();
    return;
  }
  paused = false;
  running = true;
  $("status-busy").hidden = false;
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
    $("status-busy").hidden = true;
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
  renderList();
  renderBody();
  renderPanels();
  renderBanner();
  renderStatus();
}

function rowContext(expanded: Set<string>): RowContext {
  return { now: now(), settings, expanded, gitOf };
}

/** Slot names with a critical or attention warning (filter chip, project marks). */
function warnedSlots(list: Warning[] | null): Set<string> {
  return new Set((list ?? []).filter((w) => w.slot && w.severity !== "info").map((w) => w.slot!));
}

function matchesFind(slot: Slot, text: string): boolean {
  if (!text) return true;
  const git = gitOf(slot);
  return [slot.name, slot.path, slot.project, slot.repo, git?.branch, slot.lease?.owner, slot.memo]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(text));
}

function visibleSlots(): Slot[] {
  const warned = filter === "attention" ? warnedSlots(currentWarnings()) : null;
  const text = findText.trim().toLowerCase();
  return slots().filter((s) => {
    if (filter === "open" && !isOpen(s)) return false;
    if (warned && !warned.has(s.name)) return false;
    return matchesFind(s, text);
  });
}

function renderList() {
  const inner = $("list-inner");
  $("view-slots").textContent = t("view.slots", { n: slots().length });
  document.querySelectorAll<HTMLElement>("#filter-chips [data-filter]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.filter === filter));
  });
  if (!doc) {
    // Without a document the details column carries the message; in a narrow window, the list
    inner.innerHTML = lastError
      ? bodyShown()
        ? ""
        : bodyMessage(errorText(lastError), { error: true, retry: true, settings: lastError.startsWith("core-not-found") })
      : `<p class="empty">${esc(t("footer.loading"))}</p>`;
    return;
  }
  const shown = visibleSlots();
  if (!slots().length) inner.innerHTML = `<p class="empty">${esc(t("empty.noSlots"))}</p>`;
  else if (!shown.length) inner.innerHTML = `<p class="empty">${esc(t("list.noMatch"))}</p>`;
  else {
    const expanded = new Set<string>(!bodyShown() && inlineOpen && selected ? [selected] : []);
    inner.innerHTML = slotList({ ...doc, slots: shown }, rowContext(expanded));
  }
  // Selection mark and list semantics on the drawn rows
  const list = $("list");
  list.removeAttribute("aria-activedescendant");
  inner.querySelectorAll<HTMLElement>("section.group").forEach((section) => {
    section.setAttribute("role", "presentation");
    const ul = section.querySelector("ul.slots");
    ul?.setAttribute("role", "group");
    ul?.setAttribute("aria-label", section.dataset.group ?? "");
  });
  inner.querySelectorAll<HTMLElement>("li.slot[data-toggle]").forEach((li, i) => {
    li.id = `slot-row-${i}`;
    li.setAttribute("role", "option");
    const on = li.dataset.toggle === selected;
    li.classList.toggle("selected", on);
    li.setAttribute("aria-selected", String(on));
    if (on) {
      list.setAttribute("aria-activedescendant", li.id);
      if (revealSelection) li.scrollIntoView({ block: "nearest" });
    }
  });
  revealSelection = false;
}

function unityButton(slot: Slot): UnityButton {
  const action = unityAction(slot);
  return action.kind === "focus" ? { kind: "focus" } : action;
}

function renderBody() {
  const slot = selectedSlot();
  $("body-title").textContent = slot?.name ?? t("app.title");
  const content = $("body-content");
  if (!doc) {
    content.innerHTML = lastError
      ? bodyMessage(errorText(lastError), { error: true, retry: true, settings: lastError.startsWith("core-not-found") })
      : bodyMessage(t("footer.loading"));
    return;
  }
  if (!slots().length) {
    content.innerHTML = bodyMessage(t("empty.noSlots"));
    return;
  }
  if (!slot) {
    content.innerHTML = bodyMessage(t("body.noSelection"), { hint: t("body.hint") });
    return;
  }
  content.innerHTML = slotBody(slot, rowContext(new Set()), unityButton(slot), settings.openTarget);
}

function renderPanels() {
  const list = currentWarnings();
  $("projects-body").innerHTML = projectsPanel(doc, settings, warnedSlots(list));
  $("warnings-body").innerHTML = warningsPanel(list);
  $("log-body").innerHTML = logPanel(doc ? (doc.recentEvents ?? []) : null, now());
  const counted = (list ?? []).filter((w) => w.severity !== "info");
  nav.setBadge("warnings", counted.length, counted.some((w) => w.severity === "critical") ? "critical" : "warn");
}

/** One banner at most: a core error while a document is on screen, a stalled start, critical commit. */
function bannerState(): BannerState | null {
  if (lastError && doc) {
    return {
      key: `error:${lastError}`,
      message: `${errorText(lastError)} ${t("error.keepLast")}`,
      warn: true,
      actions: [{ label: t("body.retry"), run: () => void refresh(true) }],
    };
  }
  if (!doc) return null;
  const critical = (currentWarnings() ?? []).filter((w) => w.severity === "critical");
  const more = (shown: number): BannerState["actions"] =>
    critical.length > shown ? [{ label: t("banner.more", { n: critical.length - shown }), run: () => nav.show("warnings") }] : [];
  const stalled = slots().filter((s) => s.editor?.state === "stalled");
  if (stalled.length) {
    const first = stalled[0];
    const pid = first.editor?.pid;
    const actions = pid ? [{ label: t("menu.focusUnity"), run: () => void call("focus_editor", { pid }).catch((e) => flashStatus(unityError(String(e)))) }] : [];
    return {
      key: `stalled:${stalled.map((s) => s.name).join(",")}`,
      message: t("banner.stalled", {
        slot: first.name,
        duration: formatDuration(elapsedSince(first.editor?.startedAt, now()) ?? 0),
      }),
      warn: true,
      actions: [...actions, ...(more(1) ?? [])],
    };
  }
  const percent = doc.system?.commit?.percent;
  if (typeof percent === "number" && percent >= settings.commitCriticalPercent) {
    return { key: "commit-critical", message: t("banner.commitCritical", { percent }), warn: true, actions: more(1) };
  }
  return null;
}

function renderBanner() {
  showBanner(bannerState());
}

/** `..\<name>` for the status bar; the full path is in the title and goes to the clipboard. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? `..\\${parts[parts.length - 1]}` : path;
}

function renderStatus() {
  const slot = selectedSlot();
  setStatusPath(slot ? shortPath(slot.path) : "", slot?.path ?? "");

  const list = currentWarnings() ?? [];
  const counted = list.filter((w) => w.severity !== "info");
  const warnEl = $("status-warnings");
  warnEl.hidden = counted.length === 0;
  warnEl.textContent = t("status.warnings", { n: counted.length });
  warnEl.className = counted.some((w) => w.severity === "critical") ? "hot" : "warn";
  warnEl.title = t("status.warningsTitle");

  const editors = $("status-editors");
  const commit = $("status-commit");
  if (doc) {
    const open = doc.system?.editorsOpen ?? slots().filter(isOpen).length;
    const max = doc.registry?.maxEditors ?? slots().length;
    editors.hidden = false;
    editors.textContent = t("status.editors", { open, max });
    editors.className = open >= max && max > 0 ? "warn" : "";
    editors.title = t(filter === "open" ? "status.editorsAll" : "status.editorsTitle");
    const percent = doc.system?.commit?.percent;
    commit.hidden = typeof percent !== "number";
    if (typeof percent === "number") {
      commit.textContent = t("header.commit", { percent });
      commit.className =
        percent >= settings.commitCriticalPercent ? "hot" : percent >= settings.commitWarnPercent ? "warn" : "";
    }
  } else {
    editors.hidden = true;
    commit.hidden = true;
  }

  // The time the core produced the document (for a sample, its own time)
  $("status-updated-text").textContent = receivedAt
    ? t("footer.updated", { time: formatClock(doc?.time ? new Date(doc.time) : new Date(receivedAt)) })
    : lastError
      ? t("status.noAnswer")
      : t("footer.loading");
  $("status-updated").className = lastError ? "hot" : "";
  $("status-updated").title = t("status.updatedTitle");
  $("status-next").textContent = paused
    ? t("footer.paused")
    : nextAt
      ? t("footer.next", { secs: Math.max(0, Math.round((nextAt - Date.now()) / 1000)) })
      : "";

  const git = $("status-git");
  git.textContent = t("status.git", { time: lastFullAt ? formatWhen(new Date(lastFullAt).toISOString(), new Date()) : t("detail.none") });
  git.title = t("status.gitTitle");

  const fetchEl = $("status-fetch");
  const fetches = slots()
    .map((s) => ({ name: s.name, at: gitOf(s)?.lastFetchAt }))
    .filter((x): x is { name: string; at: string } => !!x.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  fetchEl.hidden = !fetches.length;
  if (fetches.length) {
    fetchEl.textContent = t("footer.fetch", { time: formatWhen(fetches[0].at, now()) });
    fetchEl.title = [t("status.fetchTitle"), ...fetches.map((f) => `${f.name}  ${formatWhen(f.at, now())}`)].join("\n");
  }

  const unreg = doc?.unregisteredEditors?.length ?? 0;
  const orphans = doc?.orphanWorkers?.length ?? 0;
  const extra = $("status-extra");
  // Only when there is something to see; both are usually zero
  extra.hidden = unreg === 0 && orphans === 0;
  extra.textContent = [unreg ? t("footer.unregistered", { n: unreg }) : "", orphans ? t("footer.orphans", { n: orphans }) : ""]
    .filter(Boolean)
    .join(" · ");
  extra.className = "warn";

  const core = $("status-core");
  core.textContent = lastResult?.source === "sample" ? t("footer.sample") : doc?.version ? t("footer.core", { version: doc.version }) : "";
  core.hidden = !core.textContent;
  core.className = lastError && !doc ? "hot" : "";
  core.title = t("status.coreTitle");
  fitStatusbar();
}

/** Durations and the countdown move every second without redrawing the rows. */
function tick() {
  const n = now();
  document.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    const ms = elapsedSince(el.dataset.since, n);
    if (ms !== null) el.textContent = formatDuration(ms);
  });
  renderStatus();
}

// ---------------------------------------------------------------- selection and screen state

function select(name: string | null, opts: { toggleInline?: boolean; reveal?: boolean } = {}) {
  const same = name === selected;
  selected = name;
  writePref("selected", name);
  // Without the details column, a click opens the row in place (a second click folds it); keys keep it as it is
  if (!bodyShown() && opts.toggleInline) inlineOpen = same ? !inlineOpen : true;
  revealSelection = opts.reveal === true;
  // First look at a slot: bring the detailed git state if it is old
  if (name && !same && Date.now() - lastFullAt > FIRST_LOOK_FULL_MS && lastFullAt !== 0) void refresh(true);
  render();
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#list-inner li.slot[data-toggle]")).map((li) => li.dataset.toggle!);
}

function moveSelection(to: "next" | "prev" | "first" | "last") {
  const names = rowNames();
  if (!names.length) return;
  const i = selected ? names.indexOf(selected) : -1;
  const index =
    to === "first" ? 0 : to === "last" ? names.length - 1 : to === "next" ? Math.min(names.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
  select(names[index], { reveal: true });
}

function setFilter(next: SlotFilter) {
  filter = next;
  writePref("slotFilter", next);
  render();
}

function setBodyOpen(open: boolean) {
  bodyOpen = open;
  app.dataset.body = open ? "open" : "hidden";
  writePref("bodyOpen", open);
  render();
}

function selectView(name: string) {
  // One screen for now; the branch screen joins this tab list later
  view = name === "slots" ? name : "slots";
  writePref("view", view);
  document.querySelectorAll<HTMLElement>("#view-tabs [role='tab']").forEach((b) => {
    const on = b.dataset.view === view;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

/** Keys that move in the list act only when the focus is on the page, the list or the details. */
function listKeysActive(): boolean {
  if (isContextMenuOpen()) return false;
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  return el.id === "list" || (!!el.closest("#list-main, #body-main") && !el.closest("#find"));
}

// ---------------------------------------------------------------- actions

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(path: string) {
  if (await copyText(path)) flashStatus(t("toast.copied"));
}

async function copyCleanup() {
  if (!doc) return;
  const text = cleanupRequest(doc, now(), gitOf);
  if (!text) {
    flashStatus(t("toast.cleanupEmpty"));
    return;
  }
  if (await copyText(text)) flashStatus(t("toast.cleanupCopied"), 3500);
}

function openError(code: string, target: OpenTarget): string {
  if (code === "not-found") return t("toast.notFound");
  if (code === "app-not-found") return t("toast.appNotFound", { app: t(`open.${target}`) });
  return t("toast.openFailed", { text: code.replace(/^spawn:/, "") });
}

/** Unity on this slot: start its editor, bring an open one to the front, or nothing (why). */
type UnityAction = { kind: "open" } | { kind: "focus"; pid: number } | { kind: "off"; reason: string };

function unityAction(slot: Slot): UnityAction {
  // Sample slots are not on this PC
  if (lastResult?.source === "sample") return { kind: "off", reason: t("unity.offSample") };
  const state = slot.editor?.state ?? "closed";
  if (slot.exists === false || state === "missing" || (slot.flags ?? []).includes("missing-path")) {
    return { kind: "off", reason: t("unity.offMissing") };
  }
  if (state === "batch") return { kind: "off", reason: t("unity.offBatch") };
  if (isOpen(slot)) {
    const pid = slot.editor?.pid;
    return pid ? { kind: "focus", pid } : { kind: "off", reason: t("unity.offOpen") };
  }
  // A closed slot someone holds (acquire -NoOpen, or a lease left after closing) is theirs to open
  const lease = slot.lease;
  if (lease && !lease.expired) return { kind: "off", reason: t("unity.offLeased", { owner: lease.owner }) };
  return { kind: "open" };
}

function unityError(code: string): string {
  const [kind, ...rest] = code.split(":");
  const text = rest.join(":");
  switch (kind) {
    case "not-found":
      return t("toast.notFound");
    case "busy":
      return t("toast.unityBusy");
    case "core-not-found":
      return t("error.core-not-found");
    case "timeout":
      return t("toast.unityTimeout");
    case "unity-missing":
      return t("toast.unityMissing", { version: text || "?" });
    case "batch-busy":
      return t("toast.unityBatch");
    case "lock-held":
      return t("toast.unityLock");
    case "window-not-found":
      return t("toast.windowNotFound");
    case "exit":
      return t("toast.unityFailed", { text: rest.slice(1).join(":") || text });
    default:
      return t("toast.unityFailed", { text: text || code });
  }
}

async function unitySlot(slot: Slot) {
  const action = unityAction(slot);
  if (action.kind === "focus") {
    await call("focus_editor", { pid: action.pid }).catch((e) => flashStatus(unityError(String(e)), 5000));
    return;
  }
  if (action.kind !== "open") return;
  // The core reads git and the commit charge first: a few seconds before the editor starts
  flashStatus(t("toast.unityOpening", { slot: slot.name }), 90_000);
  try {
    const r = await call<OpenResult | null>("open_in_unity", { path: slot.path });
    if (r?.outcome === "already-open") flashStatus(t("toast.unityAlreadyOpen", { slot: slot.name }));
    else if (r?.warnings?.length) flashStatus(t("toast.unityStartedTight", { slot: slot.name }), 6000);
    else flashStatus(t("toast.unityStarted", { slot: slot.name }), 4000);
  } catch (e) {
    flashStatus(unityError(String(e)), 5000);
  }
  // The row turns to "starting"; the refresh rhythm speeds up while it starts
  void refresh(false);
}

async function openSlot(slot: Slot, target: OpenTarget) {
  try {
    await call("open_with", { path: slot.path, target });
  } catch (e) {
    flashStatus(openError(String(e), target), 4000);
  }
}

async function openLog(path: string) {
  await call("open_log", { path }).catch(() => flashStatus(t("toast.notFound")));
}

function slotMenu(slot: Slot): MenuEntry[] {
  const unity = unityAction(slot);
  const target = settings.openTarget;
  const entries: MenuEntry[] = [
    {
      label:
        unity.kind === "open"
          ? t("menu.openUnity")
          : unity.kind === "focus"
            ? t("menu.focusUnity")
            : t("menu.openUnityOff", { reason: unity.reason }),
      disabled: unity.kind === "off",
      action: () => void unitySlot(slot),
    },
    "separator",
    { label: t("menu.open", { app: t(`open.${target}`) }), shortcut: "Ctrl+O", action: () => void openSlot(slot, target) },
  ];
  // Open already is Explorer: one item is enough
  if (target !== "explorer") entries.push({ label: t("menu.openExplorer"), action: () => void openSlot(slot, "explorer") });
  entries.push(
    { label: t("btn.log"), action: () => void openLog(slot.path) },
    "separator",
    { label: t("btn.copyPath"), shortcut: "Ctrl+C", action: () => void copyPath(slot.path) },
  );
  return entries;
}

function openSettings(category?: CategoryId) {
  settingsDialog.open(category);
}

function onTop(): boolean {
  return settings.windowOnTop;
}

function appMenu(): MenuEntry[] {
  return [
    { label: t("menu.refresh"), shortcut: "F5", action: () => void refresh(false) },
    { label: t("menu.refreshFull"), shortcut: "Shift+F5", action: () => void refresh(true) },
    "separator",
    { label: t("menu.cleanup"), shortcut: "Ctrl+Shift+C", action: () => void copyCleanup() },
    { label: t("menu.events"), action: () => nav.show("log") },
    "separator",
    { label: t("menu.sidePanel"), checked: nav.isOpen(), shortcut: "Ctrl+Shift+E", action: () => nav.toggle() },
    { label: t("menu.details"), checked: bodyOpen, shortcut: "Ctrl+\\", action: () => setBodyOpen(!bodyOpen) },
    { label: t("menu.onTop"), checked: onTop(), action: () => void setOnTop(!onTop()) },
    { label: t("menu.theme"), shortcut: "Ctrl+Shift+D", action: () => void toggleTheme() },
    "separator",
    { label: t("menu.settings"), shortcut: "Ctrl+,", action: () => openSettings() },
    { label: t("menu.quit"), danger: true, action: () => void call("quit_app") },
  ];
}

async function showExtraDialog() {
  const n = now();
  const lines = [
    ...(doc?.unregisteredEditors ?? []).map((e) =>
      t("extra.editorLine", {
        pid: e.pid,
        project: e.project ?? t("detail.none"),
        gb: formatGb(e.memory?.totalPrivGB),
        time: formatWhen(e.startedAt, n),
      }),
    ),
    ...(doc?.orphanWorkers ?? []).map((w) =>
      t("extra.workerLine", { pid: w.pid, owner: w.ownerPid ?? t("detail.none"), project: w.project ?? t("detail.none"), gb: formatGb(w.privGB) }),
    ),
  ];
  await showDialog({ title: t("extra.title"), message: t("extra.note"), detail: lines.join("\n") });
}

// ---------------------------------------------------------------- settings

async function toggleTheme() {
  const next = oppositeChoice(theme.base());
  flashStatus(t(next === "dark" ? "theme.dark" : "theme.light"));
  await patchSettings({ theme: next });
}

async function setOnTop(on: boolean) {
  flashStatus(t(on ? "status.onTopOn" : "status.onTopOff"));
  await patchSettings({ windowOnTop: on });
}

function applyTexts() {
  applyDomTexts();
  titlebar.relabel();
  nav.relabel();
  relabelBanner();
  settingsDialog.relabel();
  void call("set_tray_labels", {
    labels: { show: t("tray.show"), settings: t("tray.settings"), quit: t("tray.quit") },
  }).catch(() => {});
}

const corePart = corePanel((text) => flashStatus(text, 5000));

/** Parts of the settings popup the schema cannot draw; each reads its state when the popup opens. */
function addSettingsPanels() {
  const onError = (text: string) => flashStatus(text, 5000);
  const parts = [
    { part: autostartPanel(() => appInfo, onError), category: "general", after: "windowOnTop" },
    { part: corePart, category: "core", after: "unitySlotScript" },
    { part: branchViewPanel(() => doc), category: "branchView" },
    { part: aboutPanel(() => appInfo, () => doc, onError), category: "about" },
  ] as const;
  for (const { part, category, ...rest } of parts) {
    settingsDialog.addPanel(category, part.element, "after" in rest ? rest.after : undefined);
    settingsDialog.onOpen(part.refresh);
  }
}

/**
 * Settings changed: here, after a save, or in widget.json. The window pin and the quick signal
 * interval are applied by the Rust side when it saves; the page applies the rest.
 */
function onSettingsChanged(changed: SettingKey[], first = false) {
  settings = getSettings();
  const lang = resolveLang(settings.language);
  if (first || lang !== currentLang()) {
    setLang(lang);
    applyTexts();
  }
  if (first || changed.includes("theme") || changed.includes("themeDurationMs")) theme.apply(settings.theme, settings.themeDurationMs);
  $("pin-btn").setAttribute("aria-pressed", String(onTop()));
  if (first) return;
  if ((changed.includes("idleSecs") || changed.includes("startingSecs")) && !running) schedule();
  if (changed.includes("unitySlotScript") || changed.includes("sampleFile")) {
    if (settingsDialog.isOpen()) corePart.refresh();
    void refresh(true);
  }
  render();
}

// ---------------------------------------------------------------- events

async function onActionClick(e: MouseEvent): Promise<boolean> {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>("[data-action]");
  if (action) {
    e.stopPropagation();
    const path = action.dataset.path ?? "";
    switch (action.dataset.action) {
      case "folder":
        await call("open_folder", { path }).catch(() => flashStatus(t("toast.notFound")));
        return true;
      case "log":
        await openLog(path);
        return true;
      case "copy":
        await copyPath(path);
        return true;
    }
  }
  const act = target.closest<HTMLElement>("[data-act]");
  if (!act) return false;
  const slot = selectedSlot();
  switch (act.dataset.act) {
    case "retry":
      void refresh(true);
      break;
    case "settings":
      openSettings("core");
      break;
    case "unity":
      if (slot) void unitySlot(slot);
      break;
    case "open":
      if (slot) void openSlot(slot, settings.openTarget);
      break;
    case "explorer":
      if (slot) void openSlot(slot, "explorer");
      break;
    case "log":
      if (slot) void openLog(slot.path);
      break;
    case "copy":
      if (slot) void copyPath(slot.path);
      break;
  }
  return true;
}

function onListClick(e: MouseEvent) {
  void onActionClick(e).then((handled) => {
    if (handled) return;
    const target = e.target as HTMLElement;
    // Clicks inside open details select text; they do not fold the row
    if (target.closest(".details")) return;
    const name = target.closest<HTMLElement>("li.slot[data-toggle]")?.dataset.toggle;
    if (name) select(name, { toggleInline: true });
  });
}

function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  // Text fields keep their own menu (paste)
  if (target.closest("input, textarea")) return;
  e.preventDefault();
  const name = target.closest<HTMLElement>("li.slot[data-toggle]")?.dataset.toggle;
  const slot = name ? slots().find((s) => s.name === name) : null;
  if (!slot) return;
  if (slot.name !== selected) select(slot.name);
  showContextMenu(e, slotMenu(slot));
}

function openRowMenu(): boolean {
  const slot = selectedSlot();
  if (!slot || !listKeysActive()) return false;
  const row = document.querySelector<HTMLElement>("#list-inner li.slot.selected");
  const r = (row ?? $("list")).getBoundingClientRect();
  showContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, slotMenu(slot));
  return true;
}

function onEscape(): boolean {
  if (isContextMenuOpen()) return false;
  const input = $("find-input") as HTMLInputElement;
  if (document.activeElement === input || findText) {
    input.value = "";
    findText = "";
    $("list").focus();
    render();
    return true;
  }
  if (overlayQuery.matches && nav.isOpen()) {
    nav.setOpen(false);
    return true;
  }
  return false;
}

function bindEvents() {
  $("list").addEventListener("click", onListClick);
  $("body-main").addEventListener("click", (e) => void onActionClick(e));
  document.addEventListener("contextmenu", onContextMenu);

  $("find-input").addEventListener("input", (e) => {
    findText = (e.target as HTMLInputElement).value;
    renderList();
  });
  $("filter-chips").addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>("[data-filter]")?.dataset.filter;
    if (isFilter(value)) setFilter(value);
  });
  $("view-tabs").addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
    if (value) selectView(value);
  });

  $("projects-body").addEventListener("click", (e) => {
    const group = (e.target as HTMLElement).closest<HTMLElement>("[data-group]")?.dataset.group;
    if (!group) return;
    document.querySelector(`#list-inner section.group[data-group="${CSS.escape(group)}"]`)?.scrollIntoView({ block: "start" });
  });
  const pickSlot = (e: Event) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]")?.dataset.slot;
    if (!name || !slots().some((s) => s.name === name)) return;
    // A filter or the find text may hide it: show everything
    if (!visibleSlots().some((s) => s.name === name)) {
      filter = "all";
      writePref("slotFilter", filter);
      findText = "";
      ($("find-input") as HTMLInputElement).value = "";
    }
    select(name, { reveal: true });
  };
  $("warnings-body").addEventListener("click", pickSlot);
  $("log-body").addEventListener("click", pickSlot);
  $("warnings-copy").addEventListener("click", () => void copyCleanup());

  $("pin-btn").addEventListener("click", () => void setOnTop(!onTop()));
  $("app-menu-btn").addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLElement;
    if (isContextMenuOpen()) hideContextMenu();
    else showMenuBelow(button, appMenu());
  });
  $("settings-btn").addEventListener("click", () => openSettings());

  $("status-path").addEventListener("click", () => {
    const slot = selectedSlot();
    if (slot) void copyPath(slot.path);
  });
  $("status-warnings").addEventListener("click", () => nav.show("warnings"));
  $("status-editors").addEventListener("click", () => setFilter(filter === "open" ? "all" : "open"));
  $("status-updated").addEventListener("click", (e) =>
    showMenuAbove(e.currentTarget as HTMLElement, [
      { label: t("menu.refresh"), shortcut: "F5", action: () => void refresh(false) },
      { label: t("menu.refreshFull"), shortcut: "Shift+F5", action: () => void refresh(true) },
    ]),
  );
  $("status-git").addEventListener("click", () => void refresh(true));
  $("status-extra").addEventListener("click", () => void showExtraDialog());
  $("status-core").addEventListener("click", () => openSettings("core"));

  setBannerFocusHome(() => $("list").focus());
  initBodyResize({ fold: () => setBodyOpen(false) });

  initKeys([
    { keys: "Ctrl+1", run: () => selectView("slots") },
    { keys: "Ctrl+Tab", run: () => selectView(view) },
    { keys: "Ctrl+Shift+Tab", run: () => selectView(view) },
    { keys: "Ctrl+Shift+E", run: () => nav.toggle(), inFields: true },
    { keys: "Ctrl+\\", run: () => setBodyOpen(!bodyOpen), inFields: true },
    {
      keys: "Ctrl+F",
      inFields: true,
      run: () => {
        const input = $("find-input") as HTMLInputElement;
        input.focus();
        input.select();
      },
    },
    { keys: "Escape", run: onEscape, inFields: true },
    { keys: "ArrowDown", run: () => listKeysActive() && (moveSelection("next"), true) },
    { keys: "ArrowUp", run: () => listKeysActive() && (moveSelection("prev"), true) },
    { keys: "Home", run: () => listKeysActive() && (moveSelection("first"), true) },
    { keys: "End", run: () => listKeysActive() && (moveSelection("last"), true) },
    {
      keys: "Enter",
      run: () => {
        const el = document.activeElement;
        if (!selected || !listKeysActive() || (el && el.closest("button, a"))) return false;
        if (bodyShown()) $("body-main").focus();
        else select(selected, { toggleInline: true });
        return true;
      },
    },
    { keys: "Shift+F10", run: openRowMenu },
    { keys: "ContextMenu", run: openRowMenu },
    {
      keys: "Ctrl+C",
      run: () => {
        const slot = selectedSlot();
        // Selected text copies as usual
        if (!slot || (window.getSelection()?.toString() ?? "") !== "") return false;
        void copyPath(slot.path);
      },
    },
    {
      keys: "Ctrl+O",
      run: () => {
        const slot = selectedSlot();
        if (slot) void openSlot(slot, settings.openTarget);
      },
    },
    { keys: "Ctrl+Shift+C", run: () => void copyCleanup(), inFields: true },
    { keys: "F5", run: () => void refresh(false), inFields: true },
    { keys: "Shift+F5", run: () => void refresh(true), inFields: true },
    { keys: "Ctrl+,", run: () => openSettings(), inFields: true },
    { keys: "Ctrl+Shift+D", run: () => void toggleTheme(), inFields: true },
  ]);

  const onWidth = () => render();
  overlayQuery.addEventListener("change", onWidth);
  narrowQuery.addEventListener("change", onWidth);
  window.addEventListener("resize", fitStatusbar);
}

// ---------------------------------------------------------------- boot

/** Browser preview only (README screenshots and checks): see backend.ts for the query. */
function applyPreviewQuery() {
  const query = new URLSearchParams(location.search);
  const pick = query.get("select");
  if (pick !== null) selected = pick || null;
  const tab = query.get("nav");
  if (tab === "closed") nav.setOpen(false);
  else if (tab) nav.show(tab);
  if (query.get("view")) view = query.get("view")!;
  if (query.get("body") === "hidden") bodyOpen = false;
  // ?frame=1200x760 draws the window at that size whatever the browser window is
  const frame = /^(\d+)x(\d+)$/.exec(query.get("frame") ?? "");
  if (frame) {
    document.body.style.width = `${frame[1]}px`;
    document.body.style.height = `${frame[2]}px`;
  }
}

async function boot() {
  if (!inTauri) applyPreviewQuery();
  app.dataset.body = bodyOpen ? "open" : "hidden";
  selectView(view);
  receiveSettings(await call<WidgetSettings>("get_settings").catch(() => null));
  appInfo = await call<AppInfo>("get_app_info").catch(() => null);
  addSettingsPanels();
  onSettingsChanged(SETTING_KEYS, true);
  onSettingsChange((changed) => onSettingsChanged(changed));
  onSettingsSaveError((error) => {
    flashStatus(t("status.saveFailed", { text: error }), 5000);
    // What the file holds now decides what the screen shows
    void call<WidgetSettings>("get_settings").then(receiveSettings).catch(() => {});
  });
  bindEvents();
  render();
  // The saved widths and open states paint without animation; then panels animate
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove("no-anim")));

  await on("slot-signal", onSignal);
  await on("widget-shown", () => void refresh(false));
  // The tray menu's Settings
  await on("open-settings", () => openSettings());

  window.setInterval(tick, 1000);
  void refresh(true);
}

void boot();
