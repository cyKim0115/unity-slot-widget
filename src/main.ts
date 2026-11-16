/**
 * Main window. It shows what `unity-slot dashboard -Json` reports and never closes or leases a
 * slot. The frame follows the author's Frond app (src/shell): title bar strips, a side panel with
 * square tabs (projects, warnings, recent events), the list in the free width, the selected item's
 * details on the right, a banner for what needs a person now, and a status bar whose items can be
 * pressed. Notices show in the status bar for a moment (flashStatus) instead of toasts.
 *
 * The slot screen (src/screens/slots.ts): project groups of two-line slot rows, then editors and
 * workers outside the registry. ↑↓ Home End pick an item, Enter and ←/→ fold a group, Shift+F10
 * opens the row's menu. Below 720px, or with the details column folded (Ctrl+\), the details open
 * over the list (the same drawing, Esc closes). The screen state (selection, filters, project,
 * folded groups, side panel, widths) comes back on the next start (localStorage, shell/prefs).
 *
 * A slot row's right-click menu and the details buttons:
 * - Open in Unity: `unity-slot open <slot> -NoWait` through the core, which makes the checks and
 *   starts the editor (the app never runs Unity.exe itself). Off for a leased, missing or
 *   batchmode slot; on an open slot it becomes Show Unity window (brings it to the front).
 *   There is no shortcut for it: starting an editor by accident costs a lot of memory.
 * - Open: the folder in another program (Fork by default). Show in Explorer. Log. Copy path.
 * - This slot's branches (the branch screen), this slot's cleanup request.
 *
 * Refresh rhythm
 * - full check (`dashboard -Json -Git basic`): every `idleSecs`, every `startingSecs` while an
 *   editor is starting (for up to five minutes), and one second after a quick change signal;
 * - detailed git (`-Git full`): every `gitFullMins`, and when a slot is selected or the branch
 *   screen opens and the last one is older than a minute;
 * - quick change signal: signals.rs, every `signalSecs` (Unity.exe ids + slot files);
 * - minimized, all of this goes on; nothing while the window is hidden to the tray.
 *
 * Out of sight, the tray tooltip, the taskbar badge and a taskbar flash for a new risk carry the
 * state (glance.ts, `set_glance`). A setting changed in widget.json by someone else applies at once.
 */

import { call, inTauri, isWindowVisible, on } from "./backend";
import { applyDomTexts, currentLang, formatClock, formatDuration, formatWhen, resolveLang, setLang, t } from "./i18n";
import { glance, newRisks } from "./glance";
import {
  cleanupRequest,
  elapsedSince,
  groupName,
  isOpen,
  mergeGit,
  nowFor,
  projectGroups,
  sharedRepos,
  urgentItems,
  warnedSlots,
  warnings,
  type CleanupScope,
  type Urgent,
  type Warning,
} from "./model";
import { logPanel } from "./panels/log";
import { projectsPanel } from "./panels/projects";
import { warningsPanel } from "./panels/warnings";
import { branchesNote, branchesPlaceholder, branchesTabLabel } from "./screens/branches";
import {
  buildSlotList,
  EXTRA_KEY,
  extraBody,
  extraTitle,
  groupBody,
  groupKey,
  parseKey,
  projectOf,
  SLOT_FILTERS,
  slotBody,
  slotKey,
  slotListHtml,
  type ItemRef,
  type SlotFilter,
  type SlotListView,
  type UnityButton,
} from "./screens/slots";
import { relabelBanner, setBannerFocusHome, showBanner, type BannerState } from "./shell/banner";
import { hideContextMenu, isContextMenuOpen, showContextMenu, showMenuAbove, showMenuBelow, type MenuEntry } from "./shell/context-menu";
import { initKeys } from "./shell/keys";
import { initNav } from "./shell/nav";
import { isBoolean, readPref, writePref } from "./shell/prefs";
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
import { bodyMessage, esc, nameHtml, type RowContext } from "./view";

const STARTING_CAP_MS = 5 * 60_000;
const FIRST_LOOK_FULL_MS = 60_000;

type View = "slots" | "branches";
const VIEWS: readonly View[] = ["slots", "branches"];
const isView = (v: unknown): v is View => VIEWS.includes(v as View);
const isFilter = (v: unknown): v is SlotFilter => SLOT_FILTERS.includes(v as SlotFilter);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

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
/** When the last refresh ended (a window shown again right after one skips another). */
let refreshedAt = 0;
/** What the tray and the taskbar show now, the risks already flashed for, and a flash to send. */
let glanceSent = "";
let knownRisks = new Set<string>();
let flashPending = false;

/** Screen state, kept per PC in localStorage (shell/prefs). `selected` is an item key (screens/slots.ts). */
let selected: string | null = readPref("selected", null, isStringOrNull);
let filter: SlotFilter = readPref("slotFilter", "all", isFilter);
let project: string | null = readPref("projectFilter", null, isStringOrNull);
let collapsed = new Set<string>(readPref("collapsedGroups", [], isStringList));
let bodyOpen = readPref("bodyOpen", true, isBoolean);
let view: View = readPref("view", "slots", isView);
let findText = "";
/** The details shown over the list (narrow window, or the details column folded). */
let sheetOpen = false;
/** Scroll the selected row into view after the next list paint (the restored one, the first time). */
let revealSelection = true;
/** The slot whose repository the branch screen marks (「이 슬롯 브랜치 보기」). */
let branchFocus: string | null = null;
/** What the list shows now: its item keys are the keyboard order. */
let listView: SlotListView | null = null;

// A selection saved as a bare slot name by an older version
if (selected && !/^[sgxew]:/.test(selected)) selected = slotKey(selected);

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const app = $("app");
/** Below 1000px the side panel opens over the list; below 720px the details open over the list. */
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

function findSlot(name: string | null | undefined): Slot | null {
  return name ? (slots().find((s) => s.name === name) ?? null) : null;
}

function selectedRef(): ItemRef | null {
  return parseKey(selected);
}

function selectedSlot(): Slot | null {
  const ref = selectedRef();
  return ref?.kind === "slot" ? findSlot(ref.name) : null;
}

/** The details column is on screen (not folded with Ctrl+\ and the window is wide enough). */
function bodyShown(): boolean {
  return bodyOpen && !narrowQuery.matches;
}

/** Without the details column, the details open over the list. */
function sheetMode(): boolean {
  return !bodyShown();
}

function setSheet(open: boolean) {
  sheetOpen = open && sheetMode();
  app.dataset.sheet = sheetOpen ? "open" : "closed";
}

function currentWarnings(): Warning[] | null {
  return doc ? warnings(doc, settings, now(), gitOf) : null;
}

function rowContext(): RowContext {
  return { now: now(), settings, gitOf, shared: sharedRepos(slots(), gitOf), events: doc?.recentEvents ?? [] };
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
    refreshedAt = Date.now();
    $("status-busy").hidden = true;
  }
  noteRisks();
  render();
  schedule();
  if (pending) {
    const next = pending;
    pending = null;
    void refresh(next.full);
  }
}

/** The detailed git state when it is older than a minute (a first look at a slot, the branch screen). */
function freshenFull() {
  if (lastFullAt !== 0 && Date.now() - lastFullAt > FIRST_LOOK_FULL_MS) void refresh(true);
}

/** A risk that was not there at the last refresh flashes the taskbar (setting flashTaskbar). */
function noteRisks() {
  if (!doc) return;
  const risks = currentGlance().risks;
  if (newRisks(knownRisks, risks).length && settings.flashTaskbar) flashPending = true;
  knownRisks = new Set(risks);
}

function currentGlance() {
  return glance({ doc, warnings: currentWarnings(), settings, error: lastError !== null, paused });
}

/** Tray tooltip and taskbar badge, sent when they change (renderStatus runs every second). */
function sendGlance() {
  const g = currentGlance();
  const key = `${g.level}|${g.status}`;
  if (key === glanceSent && !flashPending) return;
  glanceSent = key;
  const attention = flashPending;
  flashPending = false;
  void call("set_glance", { status: g.status, level: g.level, attention }).catch(() => {});
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
  // A saved project that is no longer registered shows every project (the saved value stays)
  if (doc && project !== null && !projectGroups(slots()).has(project)) project = null;
  renderList();
  renderBody();
  renderPanels();
  renderBanner();
  renderStatus();
}

function errorMessage(): string {
  return bodyMessage(errorText(lastError!), { error: true, retry: true, settings: lastError!.startsWith("core-not-found") });
}

function renderTools() {
  $("view-slots").textContent = t("view.slots", { n: slots().length });
  $("view-branches").textContent = branchesTabLabel(doc);
  document.querySelectorAll<HTMLElement>("#filter-chips [data-filter]").forEach((b) => {
    const on = b.dataset.filter === filter;
    b.setAttribute("aria-checked", String(on));
    // One tab stop for the group (radio pattern); ←/→ move between the chips
    b.tabIndex = on ? 0 : -1;
  });
  // The slot filter belongs to the slot screen; the branch screen brings its own
  $("filter-chips").hidden = view !== "slots";
  const pick = $("project-btn");
  pick.querySelector(".pick-label")!.textContent = project ?? t("panel.allProjects");
  pick.classList.toggle("on", project !== null);
  pick.title = t("project.title");
}

function renderList() {
  renderTools();
  const inner = $("list-inner");
  const list = $("list");
  list.removeAttribute("aria-activedescendant");
  if (!doc) {
    listView = null;
    // Without a document the details column carries the message; in a narrow window, the list
    inner.innerHTML = lastError
      ? bodyShown()
        ? ""
        : errorMessage()
      : `<p class="empty">${esc(t("footer.loading"))}</p>`;
    return;
  }
  if (view === "branches") {
    listView = null;
    list.setAttribute("role", "region");
    list.setAttribute("aria-label", t("view.branchesLabel"));
    inner.innerHTML = branchesPlaceholder(doc, project, rowContext(), branchFocus);
    if (revealSelection) inner.querySelector(".repo-row.focus")?.scrollIntoView({ block: "nearest" });
    revealSelection = false;
    return;
  }
  list.setAttribute("role", "tree");
  list.setAttribute("aria-label", t("list.label"));
  const ctx = rowContext();
  listView = buildSlotList(
    doc,
    { filter, project, find: findText, collapsed, warned: warnedSlots(currentWarnings()) },
    ctx,
  );
  if (!slots().length && !listView.extra) inner.innerHTML = `<p class="empty">${esc(t("empty.noSlots"))}</p>`;
  else if (!listView.keys.length) inner.innerHTML = `<p class="empty">${esc(t("list.noMatch"))}</p>`;
  else inner.innerHTML = slotListHtml(listView, ctx);
  // Ids for aria-activedescendant and the selection mark
  inner.querySelectorAll<HTMLElement>("[data-item]").forEach((el, i) => {
    el.id = `item-${i}`;
    const on = el.dataset.item === selected;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-selected", String(on));
    if (on) {
      list.setAttribute("aria-activedescendant", el.id);
      if (revealSelection) el.scrollIntoView({ block: "nearest" });
    }
  });
  revealSelection = false;
}

function unityButton(slot: Slot): UnityButton {
  const action = unityAction(slot);
  return action.kind === "focus" ? { kind: "focus" } : action;
}

function itemTitle(ref: ItemRef | null): string {
  if (!ref) return t("app.title");
  switch (ref.kind) {
    case "slot":
    case "group":
      return ref.name;
    case "extra":
      return extraTitle(doc?.unregisteredEditors?.length ?? 0, doc?.orphanWorkers?.length ?? 0);
    case "editor":
      return t("extra.editor", { pid: ref.pid });
    case "worker":
      return t("extra.worker", { pid: ref.pid });
  }
}

function bodyContent(): string {
  if (!doc) return lastError ? errorMessage() : bodyMessage(t("footer.loading"));
  if (view === "branches") return bodyMessage(branchesNote(doc), { hint: t("body.branchesHint") });
  if (!slots().length && !doc.unregisteredEditors?.length && !doc.orphanWorkers?.length) return bodyMessage(t("empty.noSlots"));
  const ref = selectedRef();
  const ctx = rowContext();
  switch (ref?.kind) {
    case "slot": {
      const slot = findSlot(ref.name);
      if (slot) return slotBody(slot, ctx, unityButton(slot), settings.openTarget);
      break;
    }
    case "group": {
      const members = projectGroups(slots()).get(ref.name);
      if (members) {
        const g = listView?.groups.find((x) => x.name === ref.name);
        const groupView = g ?? { name: ref.name, key: groupKey(ref.name), members, shown: members, collapsed: false, repos: [] };
        return groupBody(groupView, ctx, project === ref.name);
      }
      break;
    }
    case "extra":
    case "editor":
    case "worker":
      return extraBody(doc, ref, ctx);
  }
  return bodyMessage(t("body.noSelection"), { hint: t("body.hint") });
}

function renderBody() {
  const title = view === "branches" ? t("view.branchesLabel") : itemTitle(doc ? selectedRef() : null);
  // Long slot names shorten in the middle here too (the clone number stays)
  $("body-title").innerHTML = nameHtml(title, "title-name");
  $("sheet-title").innerHTML = nameHtml(title, "title-name");
  $("body-content").innerHTML = bodyContent();
}

function renderPanels() {
  const list = currentWarnings();
  $("projects-body").innerHTML = projectsPanel(doc, settings, warnedSlots(list), project, doc ? rowContext() : null);
  $("warnings-body").innerHTML = warningsPanel(list);
  $("log-body").innerHTML = logPanel(doc ? (doc.recentEvents ?? []) : null, now());
  const counted = (list ?? []).filter((w) => w.severity !== "info");
  nav.setBadge("warnings", counted.length, counted.some((w) => w.severity === "critical") ? "critical" : "warn");
}

function focusEditor(pid: number) {
  void call("focus_editor", { pid }).catch((e) => flashStatus(unityError(String(e)), 5000));
}

/** One banner at most, the most urgent (model.ts `urgentItems`); the rest are counted toward the warnings panel. */
function bannerState(): BannerState | null {
  const items = urgentItems(doc, settings, lastError);
  if (!items.length) return null;
  const first: Urgent = items[0];
  const critical = (currentWarnings() ?? []).filter((w) => w.severity === "critical").length;
  // The error is no warning; the others are among the critical ones
  const rest = first.kind === "error" ? critical : critical - 1;
  const more: BannerState["actions"] = rest > 0 ? [{ label: t("banner.more", { n: rest }), run: () => nav.show("warnings") }] : [];
  switch (first.kind) {
    case "error":
      return {
        key: `error:${first.code}`,
        message: `${errorText(first.code)} ${t("error.keepLast")}`,
        warn: true,
        actions: [{ label: t("body.retry"), run: () => void refresh(true) }, ...more],
      };
    case "stalled": {
      const pid = first.slot.editor?.pid;
      return {
        key: `stalled:${items.filter((i) => i.kind === "stalled").map((i) => (i.kind === "stalled" ? i.slot.name : "")).join(",")}`,
        message: t("banner.stalled", {
          slot: first.slot.name,
          duration: formatDuration(elapsedSince(first.slot.editor?.startedAt, now()) ?? 0),
        }),
        warn: true,
        actions: [...(pid ? [{ label: t("menu.focusUnity"), run: () => focusEditor(pid) }] : []), ...more],
      };
    }
    case "commit":
      return { key: "commit-critical", message: t("banner.commitCritical", { percent: first.percent }), warn: true, actions: more };
  }
}

function renderBanner() {
  showBanner(bannerState());
}

/** `..\<name>` for the status bar; the full path is in the title and goes to the clipboard. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? `..\\${parts[parts.length - 1]}` : path;
}

/** The path of the selected item: a slot folder, or the project folder of an editor or worker. */
function selectedPath(): string | null {
  const ref = selectedRef();
  if (!ref || !doc) return null;
  if (ref.kind === "slot") return findSlot(ref.name)?.path ?? null;
  if (ref.kind === "editor") return doc.unregisteredEditors?.find((e) => e.pid === ref.pid)?.project ?? null;
  if (ref.kind === "worker") return doc.orphanWorkers?.find((w) => w.pid === ref.pid)?.project ?? null;
  return null;
}

function renderStatus() {
  const path = selectedPath();
  setStatusPath(path ? shortPath(path) : "", path ?? "");

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
    editors.title = t(filter === "open" && view === "slots" ? "status.editorsAll" : "status.editorsTitle");
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
  extra.title = t("status.extraTitle");

  const core = $("status-core");
  core.textContent = lastResult?.source === "sample" ? t("footer.sample") : doc?.version ? t("footer.core", { version: doc.version }) : "";
  core.hidden = !core.textContent;
  core.className = lastError && !doc ? "hot" : "";
  core.title = t("status.coreTitle");
  fitStatusbar();
  sendGlance();
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

function saveCollapsed() {
  writePref("collapsedGroups", [...collapsed]);
}

/** The group key a selection sits in (a slot's project, the extra group of an editor or worker). */
function parentKey(ref: ItemRef | null): string | null {
  if (!ref) return null;
  if (ref.kind === "slot") {
    const slot = findSlot(ref.name);
    return slot ? groupKey(groupName(slot)) : null;
  }
  if (ref.kind === "editor" || ref.kind === "worker") return EXTRA_KEY;
  return null;
}

/**
 * Selects an item. `open` shows the details over the list when the details column is not on
 * screen (a press on a row: pressing the open one again closes them). `reveal` scrolls it into view.
 */
function select(key: string | null, opts: { open?: boolean; reveal?: boolean } = {}) {
  const same = key === selected;
  selected = key;
  writePref("selected", key);
  const ref = parseKey(key);
  // A slot in a folded group (picked from a panel): unfold it
  const parent = parentKey(ref);
  if (parent && collapsed.delete(parent)) saveCollapsed();
  if (opts.open && sheetMode()) setSheet(same ? !sheetOpen : true);
  revealSelection = opts.reveal === true;
  // First look at a slot: bring the detailed git state if it is old
  if (ref?.kind === "slot" && !same) freshenFull();
  render();
}

function moveSelection(to: "next" | "prev" | "first" | "last") {
  const keys = listView?.keys ?? [];
  if (!keys.length) return;
  const i = selected ? keys.indexOf(selected) : -1;
  const index =
    to === "first" ? 0 : to === "last" ? keys.length - 1 : to === "next" ? Math.min(keys.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
  select(keys[index], { reveal: true });
}

function toggleGroup(key: string, open?: boolean) {
  const fold = open === undefined ? !collapsed.has(key) : !open;
  if (fold) collapsed.add(key);
  else collapsed.delete(key);
  saveCollapsed();
  // The selection inside a group that folds moves to its head
  if (fold && parentKey(selectedRef()) === key) {
    selected = key;
    writePref("selected", key);
  }
  render();
}

/** ←/→ on the list: fold, unfold, go to the group head or into the group (tree pattern). */
function stepTree(right: boolean): boolean {
  const ref = selectedRef();
  if (!ref || !listView) return false;
  if (ref.kind === "group" || ref.kind === "extra") {
    const key = selected!;
    const isCollapsed = collapsed.has(key);
    if (!right && !isCollapsed) toggleGroup(key, false);
    else if (right && isCollapsed) toggleGroup(key, true);
    else if (right) {
      const keys = listView.keys;
      const next = keys[keys.indexOf(key) + 1];
      if (next && parentKey(parseKey(next)) === key) select(next, { reveal: true });
    }
    return true;
  }
  if (!right) {
    const parent = parentKey(ref);
    if (parent) select(parent, { reveal: true });
  }
  return true;
}

function setFilter(next: SlotFilter) {
  filter = next;
  writePref("slotFilter", next);
  render();
}

function setProject(next: string | null) {
  project = next;
  writePref("projectFilter", next);
  revealSelection = true;
  render();
}

function setBodyOpen(open: boolean) {
  bodyOpen = open;
  app.dataset.body = open ? "open" : "hidden";
  writePref("bodyOpen", open);
  setSheet(false);
  render();
}

function paintViewTabs() {
  document.querySelectorAll<HTMLElement>("#view-tabs [role='tab']").forEach((b) => {
    const on = b.dataset.view === view;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
}

function selectView(next: View) {
  if (next === view) return;
  view = next;
  writePref("view", view);
  if (view !== "branches") branchFocus = null;
  setSheet(false);
  paintViewTabs();
  // The branch screen reads the detailed git state: bring it when it is old
  if (view === "branches") freshenFull();
  render();
}

function stepView(delta: number) {
  selectView(VIEWS[(VIEWS.indexOf(view) + delta + VIEWS.length) % VIEWS.length]);
}

/** 「이 슬롯 브랜치 보기」: the branch screen on the slot's project, its repository marked. */
function showSlotBranches(slot: Slot) {
  branchFocus = slot.name;
  revealSelection = true;
  project = groupName(slot);
  writePref("projectFilter", project);
  if (view === "branches") render();
  else selectView("branches");
}

/** Shows `key` whatever the filter, the project and the find text (a press in a panel or the status bar). */
function reveal(key: string) {
  if (view !== "slots") selectView("slots");
  const ref = parseKey(key);
  const owner = projectOf(ref, doc);
  const hidden = () => !(buildSlotList(doc!, { filter, project, find: findText, collapsed: new Set(), warned: warnedSlots(currentWarnings()) }, rowContext()).keys.includes(key));
  if (doc && hidden()) {
    filter = "all";
    writePref("slotFilter", filter);
    findText = "";
    ($("find-input") as HTMLInputElement).value = "";
    if (project !== null && (owner === null || owner !== project)) {
      project = null;
      writePref("projectFilter", null);
    }
  }
  select(key, { reveal: true });
}

/** Keys that move in the list act only when the focus is on the page, the list or the details. */
function listKeysActive(): boolean {
  if (isContextMenuOpen()) return false;
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  return el.id === "list" || (!!el.closest("#list-main, #body-main") && !el.closest("#list-tools"));
}

/** ←/→ fold groups only when the list itself has the focus (the chips use them too). */
function treeKeysActive(): boolean {
  if (isContextMenuOpen() || view !== "slots") return false;
  const el = document.activeElement;
  return !el || el === document.body || el.id === "list";
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

/** The cleanup request for everything, the project filter, a project or one slot. */
async function copyCleanup(scope: CleanupScope = {}) {
  if (!doc) return;
  const text = cleanupRequest(doc, now(), gitOf, scope);
  if (!text) {
    flashStatus(t("toast.cleanupEmpty"));
    return;
  }
  if (await copyText(text)) flashStatus(t("toast.cleanupCopied"), 3500);
}

function projectScope(name: string | null): CleanupScope {
  if (name === null) return {};
  return { slots: new Set((projectGroups(slots()).get(name) ?? []).map((s) => s.name)), label: name };
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

async function openFolder(path: string) {
  await call("open_folder", { path }).catch(() => flashStatus(t("toast.notFound")));
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
    { label: t("menu.slotBranches"), action: () => showSlotBranches(slot) },
    { label: t("menu.slotCleanup"), action: () => void copyCleanup({ slots: new Set([slot.name]), label: slot.name }) },
    "separator",
    { label: t("btn.copyPath"), shortcut: "Ctrl+C", action: () => void copyPath(slot.path) },
  );
  return entries;
}

function groupMenu(name: string): MenuEntry[] {
  const key = groupKey(name);
  const folded = collapsed.has(key);
  return [
    { label: t(folded ? "menu.unfold" : "menu.fold"), shortcut: "Enter", action: () => toggleGroup(key) },
    { label: t(project === name ? "group.showAll" : "group.onlyThis"), action: () => setProject(project === name ? null : name) },
    "separator",
    { label: t("menu.cleanupScope", { scope: name }), action: () => void copyCleanup(projectScope(name)) },
  ];
}

function extraMenu(ref: ItemRef): MenuEntry[] {
  if (ref.kind === "extra") return [{ label: t(collapsed.has(EXTRA_KEY) ? "menu.unfold" : "menu.fold"), action: () => toggleGroup(EXTRA_KEY) }];
  const path = selectedPath();
  const entries: MenuEntry[] = [];
  if (ref.kind === "editor") entries.push({ label: t("menu.focusUnity"), action: () => focusEditor(ref.pid) }, "separator");
  if (path) {
    entries.push(
      { label: t("menu.openExplorer"), action: () => void openFolder(path) },
      { label: t("btn.copyPath"), shortcut: "Ctrl+C", action: () => void copyPath(path) },
    );
  }
  return entries;
}

function itemMenu(ref: ItemRef | null): MenuEntry[] {
  if (!ref) return [];
  if (ref.kind === "slot") {
    const slot = findSlot(ref.name);
    return slot ? slotMenu(slot) : [];
  }
  if (ref.kind === "group") return groupMenu(ref.name);
  return extraMenu(ref);
}

function openSettings(category?: CategoryId) {
  settingsDialog.open(category);
}

function onTop(): boolean {
  return settings.windowOnTop;
}

function cleanupLabel(): string {
  return project === null ? t("menu.cleanup") : t("menu.cleanupScope", { scope: project });
}

function appMenu(): MenuEntry[] {
  return [
    { label: t("menu.refresh"), shortcut: "F5", action: () => void refresh(false) },
    { label: t("menu.refreshFull"), shortcut: "Shift+F5", action: () => void refresh(true) },
    "separator",
    { label: cleanupLabel(), shortcut: "Ctrl+Shift+C", action: () => void copyCleanup(projectScope(project)) },
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

function projectMenu(): MenuEntry[] {
  return [
    { label: t("panel.allProjects"), checked: project === null, action: () => setProject(null) },
    "separator",
    ...[...projectGroups(slots()).keys()].map((name): MenuEntry => ({ label: name, checked: project === name, action: () => setProject(name) })),
  ];
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

/** Buttons in the details column and the list (`data-act`). True when one was pressed. */
function onActionClick(e: MouseEvent): boolean {
  const target = e.target as HTMLElement;
  const pick = target.closest<HTMLElement>("[data-pick], [data-pick-item]");
  if (pick) {
    reveal(pick.dataset.pickItem ?? slotKey(pick.dataset.pick!));
    return true;
  }
  const act = target.closest<HTMLElement>("[data-act]");
  if (!act) return false;
  e.stopPropagation();
  const slot = selectedSlot();
  const data = act.dataset;
  switch (data.act) {
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
    case "branches":
      if (slot) showSlotBranches(slot);
      break;
    case "project":
      setProject(project === data.project ? null : (data.project ?? null));
      break;
    case "cleanup-project":
      void copyCleanup(projectScope(data.project ?? null));
      break;
    case "focus-pid":
      if (data.pid) focusEditor(Number(data.pid));
      break;
    case "folder":
      if (data.path) void openFolder(data.path);
      break;
    case "copy-text":
      if (data.text) void copyPath(data.text);
      break;
  }
  return true;
}

function onListClick(e: MouseEvent) {
  if (onActionClick(e)) return;
  const target = e.target as HTMLElement;
  const item = target.closest<HTMLElement>("[data-item]");
  if (!item) return;
  const key = item.dataset.item!;
  // The chevron folds; a press elsewhere selects (and opens the details over a narrow list)
  if (target.closest("[data-fold]")) {
    toggleGroup(key);
    return;
  }
  select(key, { open: true });
}

function onListDoubleClick(e: MouseEvent) {
  const head = (e.target as HTMLElement).closest<HTMLElement>(".group-head[data-item]");
  if (head && !(e.target as HTMLElement).closest("[data-fold]")) toggleGroup(head.dataset.item!);
}

function onContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement;
  // Text fields keep their own menu (paste)
  if (target.closest("input, textarea")) return;
  e.preventDefault();
  const key = target.closest<HTMLElement>("#list [data-item]")?.dataset.item;
  if (!key) return;
  if (key !== selected) select(key);
  const entries = itemMenu(parseKey(key));
  if (entries.length) showContextMenu(e, entries);
}

function openRowMenu(): boolean {
  if (!selected || !listKeysActive() || view !== "slots") return false;
  const entries = itemMenu(selectedRef());
  if (!entries.length) return false;
  const row = document.querySelector<HTMLElement>("#list-inner [data-item].selected");
  const r = (row ?? $("list")).getBoundingClientRect();
  showContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, entries);
  return true;
}

function onEnter(): boolean {
  const el = document.activeElement;
  if (!selected || !listKeysActive() || view !== "slots" || (el && el.closest("button, a"))) return false;
  const ref = selectedRef();
  if (ref?.kind === "group" || ref?.kind === "extra") {
    toggleGroup(selected);
    return true;
  }
  if (sheetMode()) {
    setSheet(true);
    renderBody();
  }
  $("body-main").focus();
  return true;
}

function onEscape(): boolean {
  if (isContextMenuOpen()) return false;
  if (sheetOpen) {
    setSheet(false);
    $("list").focus();
    return true;
  }
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

function showExtra() {
  if (!doc?.unregisteredEditors?.length && !doc?.orphanWorkers?.length) return;
  if (collapsed.delete(EXTRA_KEY)) saveCollapsed();
  if (project !== null) {
    project = null;
    writePref("projectFilter", null);
  }
  reveal(EXTRA_KEY);
}

function bindEvents() {
  $("list").addEventListener("click", onListClick);
  $("list").addEventListener("dblclick", onListDoubleClick);
  $("body-main").addEventListener("click", (e) => void onActionClick(e));
  document.addEventListener("contextmenu", onContextMenu);
  $("sheet-back").addEventListener("click", () => {
    setSheet(false);
    $("list").focus();
  });

  $("find-input").addEventListener("input", (e) => {
    findText = (e.target as HTMLInputElement).value;
    renderList();
  });
  $("filter-chips").addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>("[data-filter]")?.dataset.filter;
    if (isFilter(value)) setFilter(value);
  });
  // ↑↓ Home End stay the list's keys (keys.ts); ←/→ pick the next chip at once, as radio buttons do
  $("filter-chips").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : SLOT_FILTERS.length - 1;
    const next = SLOT_FILTERS[(SLOT_FILTERS.indexOf(filter) + step) % SLOT_FILTERS.length];
    setFilter(next);
    document.querySelector<HTMLElement>(`#filter-chips [data-filter="${next}"]`)?.focus();
  });
  $("project-btn").addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLElement;
    if (isContextMenuOpen()) hideContextMenu();
    else showMenuBelow(button, projectMenu());
  });
  $("view-tabs").addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view;
    if (isView(value)) selectView(value);
  });
  // Roving tab index over the screen tabs, as the side panel's tabs do
  $("view-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    stepView(e.key === "ArrowRight" ? 1 : -1);
    document.querySelector<HTMLElement>(`#view-tabs [data-view="${view}"]`)?.focus();
  });

  $("projects-body").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-extra]")) {
      showExtra();
      return;
    }
    const row = target.closest<HTMLElement>("[data-project]");
    if (row) setProject(row.dataset.project || null);
  });
  const pickSlot = (e: Event) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]")?.dataset.slot;
    if (!name || !findSlot(name)) return;
    reveal(slotKey(name));
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
    const path = selectedPath();
    if (path) void copyPath(path);
  });
  $("status-warnings").addEventListener("click", () => nav.show("warnings"));
  $("status-editors").addEventListener("click", () => {
    const next = filter === "open" && view === "slots" ? "all" : "open";
    if (view !== "slots") selectView("slots");
    setFilter(next);
  });
  $("status-updated").addEventListener("click", (e) =>
    showMenuAbove(e.currentTarget as HTMLElement, [
      { label: t("menu.refresh"), shortcut: "F5", action: () => void refresh(false) },
      { label: t("menu.refreshFull"), shortcut: "Shift+F5", action: () => void refresh(true) },
    ]),
  );
  $("status-git").addEventListener("click", () => void refresh(true));
  $("status-extra").addEventListener("click", showExtra);
  $("status-core").addEventListener("click", () => openSettings("core"));

  setBannerFocusHome(() => $("list").focus());
  initBodyResize({ fold: () => setBodyOpen(false) });

  const inList = (fn: () => void) => () => listKeysActive() && view === "slots" && (fn(), true);
  initKeys([
    { keys: "Ctrl+1", run: () => selectView("slots") },
    { keys: "Ctrl+2", run: () => selectView("branches") },
    { keys: "Ctrl+Tab", run: () => stepView(1) },
    { keys: "Ctrl+Shift+Tab", run: () => stepView(-1) },
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
    { keys: "ArrowDown", run: inList(() => moveSelection("next")) },
    { keys: "ArrowUp", run: inList(() => moveSelection("prev")) },
    { keys: "Home", run: inList(() => moveSelection("first")) },
    { keys: "End", run: inList(() => moveSelection("last")) },
    { keys: "ArrowLeft", run: () => treeKeysActive() && stepTree(false) },
    { keys: "ArrowRight", run: () => treeKeysActive() && stepTree(true) },
    { keys: "Enter", run: onEnter },
    { keys: "Shift+F10", run: openRowMenu },
    { keys: "ContextMenu", run: openRowMenu },
    {
      keys: "Ctrl+C",
      run: () => {
        const path = selectedPath();
        // Selected text copies as usual
        if (!path || (window.getSelection()?.toString() ?? "") !== "") return false;
        void copyPath(path);
      },
    },
    {
      keys: "Ctrl+O",
      run: () => {
        const slot = selectedSlot();
        if (slot) void openSlot(slot, settings.openTarget);
      },
    },
    { keys: "Ctrl+Shift+C", run: () => void copyCleanup(projectScope(project)), inFields: true },
    { keys: "F5", run: () => void refresh(false), inFields: true },
    { keys: "Shift+F5", run: () => void refresh(true), inFields: true },
    { keys: "Ctrl+,", run: () => openSettings(), inFields: true },
    { keys: "Ctrl+Shift+D", run: () => void toggleTheme(), inFields: true },
  ]);

  const onWidth = () => {
    // The details column came back: what was over the list goes
    if (!sheetMode()) setSheet(false);
    render();
  };
  overlayQuery.addEventListener("change", onWidth);
  narrowQuery.addEventListener("change", onWidth);
  window.addEventListener("resize", fitStatusbar);
}

// ---------------------------------------------------------------- boot

/** Browser preview only (README screenshots and checks): see backend.ts for the query. */
function applyPreviewQuery() {
  const query = new URLSearchParams(location.search);
  const pick = query.get("select");
  if (pick !== null) selected = pick ? (/^[sgxew]:/.test(pick) ? pick : slotKey(pick)) : null;
  const tab = query.get("nav");
  if (tab === "closed") nav.setOpen(false);
  else if (tab) nav.show(tab);
  const v = query.get("view");
  if (isView(v)) view = v;
  if (query.has("project")) project = query.get("project") || null;
  const f = query.get("filter");
  if (isFilter(f)) filter = f;
  if (query.get("body") === "hidden") bodyOpen = false;
  if (query.get("sheet") === "open") sheetOpen = true;
  // ?frame=1200x760 draws the window at that size whatever the browser window is
  const frame = /^(\d+)x(\d+)$/.exec(query.get("frame") ?? "");
  if (frame) {
    document.body.style.width = `${frame[1]}px`;
    document.body.style.height = `${frame[2]}px`;
  }
}

/** After the next paint. A window that is still hidden may get no animation frame: a timer ends the wait too. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}

async function boot() {
  if (!inTauri) applyPreviewQuery();
  app.dataset.body = bodyOpen ? "open" : "hidden";
  setSheet(sheetOpen);
  paintViewTabs();
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
  // The window starts hidden; it shows once this first paint is ready (no white page flashes)
  await afterPaint();
  await call("window_ready").catch(() => {});

  await on("slot-signal", onSignal);
  const reloadSettings = () => void call<WidgetSettings>("get_settings").then(receiveSettings).catch(() => {});
  // Back from the tray: settings may have changed meanwhile; refresh unless one just ended
  await on("widget-shown", () => {
    reloadSettings();
    if (Date.now() - refreshedAt > 5000) void refresh(false);
  });
  // widget.json changed (here or by someone else): what the file holds now applies
  await on("settings-file-changed", reloadSettings);
  // The tray menu's Settings
  await on("open-settings", () => openSettings());

  window.setInterval(tick, 1000);
  void refresh(true);
}

void boot();
