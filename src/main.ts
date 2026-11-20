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
 * - This slot's branches (the branch screen, only what the slot has), this slot's cleanup request.
 *
 * The branch screen (src/screens/branches.ts, core 0.7.0 `repos[]`; src/branches.ts judges): per
 * project the repository row, branches by name across the clones (most serious first, filters
 * 「주의」·체크아웃·전체), changes in progress and stashes, with its own selection and folded heads.
 * Its menus only read, copy and open. The one button that writes runs the core's `branch-view`
 * (a view repository whose remotes are the slots; the core only reads the slots): a person presses
 * it, a new one is planned first and confirmed, then it is made or refreshed and opened in Fork.
 * With a core before 0.7.0 it shows each repository's counts and says 0.7.0 is needed.
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

import { ALIAS_MAX_CHARS, cleanAlias, projectAlias, projectLabel, receiveAliases } from "./aliases";
import { call, inTauri, isWindowVisible, on } from "./backend";
import { applyDomTexts, currentLang, formatClock, formatDuration, formatSize, formatWhen, resolveLang, setLang, t } from "./i18n";
import { glance, newRisks } from "./glance";
import { fadeIn, playList, snapshotList } from "./motion";
import {
  cleanupRequest,
  detachedName,
  elapsedSince,
  fullRepos,
  groupName,
  isOpen,
  mergeGit,
  mergeRepos,
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
import {
  BRANCH_FILTERS,
  branchCleanupRequest,
  branchCounts,
  buildProjects,
  viewRef,
  type BranchFilter,
  type ProjectBranches,
} from "./branches";
import { logPanel } from "./panels/log";
import { projectsPanel } from "./panels/projects";
import { warningsPanel } from "./panels/warnings";
import {
  bBranchKey,
  bProjectKey,
  bRepoKey,
  branchBody,
  branchesTabLabel,
  branchHome,
  branchItemTitle,
  branchListHtml,
  branchParentKey,
  buildBranchList,
  changeBody,
  hasBranchViews,
  hasRepos,
  isBranchFoldKey,
  isBranchKey,
  oldCoreBody,
  oldCoreList,
  parseBranchKey,
  projectBody,
  repoBody,
  stashBody,
  subgroupBody,
  viewLine,
  type BranchContext,
  type BranchListView,
  type ProjectView,
  type ViewAction,
} from "./screens/branches";
import { showDialog, showPrompt } from "./shell/dialog";
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
  type StaleLeaseButton,
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
import type {
  AppInfo,
  BranchViewPlan,
  BranchViewResult,
  Dashboard,
  DashboardResult,
  GitState,
  OpenResult,
  OpenTarget,
  ReleaseResult,
  RepoGit,
  Slot,
  WidgetSettings,
} from "./types";
import { OPEN_TARGETS, SUPPORTED_SCHEMA_MAJOR } from "./types";
import { bodyMessage, esc, nameHtml, type RowContext } from "./view";

const STARTING_CAP_MS = 5 * 60_000;
const FIRST_LOOK_FULL_MS = 60_000;

type View = "slots" | "branches";
const VIEWS: readonly View[] = ["slots", "branches"];
const isView = (v: unknown): v is View => VIEWS.includes(v as View);
const isFilter = (v: unknown): v is SlotFilter => SLOT_FILTERS.includes(v as SlotFilter);
const isBranchFilter = (v: unknown): v is BranchFilter => BRANCH_FILTERS.includes(v as BranchFilter);
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
/** The last full answer per git directory (core 0.7.0 `repos[]`), by repoKey. */
let fullRepoMap = new Map<string, RepoGit>();
let lastFullAt = 0;
/** The core's time on the last full answer (the branch screen's 「마지막 자세한 git」). */
let lastFullDocTime: string | null = null;

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
/** The screen the list drew last and what the details column showed last (motion.ts). */
let lastScreen: View | null = null;
let lastBodyKey: string | null = null;
/** What the list shows now: its item keys are the keyboard order. */
let listView: SlotListView | null = null;

/** The branch screen (screens/branches.ts): its own selection, folded heads and filter. */
let branchSelected: string | null = readPref("branchSelected", null, isStringOrNull);
let branchCollapsed = new Set<string>(readPref("branchCollapsed", [], isStringList));
let branchFilter: BranchFilter = readPref("branchFilter", "attention", isBranchFilter);
/** 「이 슬롯 브랜치 보기」: only what this slot has, until the branch screen is left. */
let branchSlot: string | null = null;
let branchList: BranchListView | null = null;
/** The branch data of the last render (core 0.7.0), or null for an older core. */
let branchData: ProjectBranches[] | null = null;
/** Preview only (?branch=<name>): select that branch once the data is there. */
let pendingBranchName: string | null = null;

/** The view repository run going on now (project group and registry project), and failures by project. */
let bvRunning: { project: string; registry: string } | null = null;
const bvErrors = new Map<string, string>();

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

/** Core 0.7.0 `repos[]` with the last full answer kept per git directory; null for an older core. */
function currentRepos(): RepoGit[] | null {
  return doc ? mergeRepos(doc.repos, fullRepoMap) : null;
}

function currentWarnings(): Warning[] | null {
  return doc ? warnings(doc, settings, now(), gitOf, currentRepos()) : null;
}

function rowContext(): RowContext {
  return { now: now(), settings, gitOf, shared: sharedRepos(slots(), gitOf), events: doc?.recentEvents ?? [], repos: currentRepos() };
}

/** The branch screen's data, once per render (it reads the settings' thresholds and the time). */
function computeBranches() {
  branchData = doc && hasRepos(doc) ? buildProjects(doc, currentRepos(), gitOf, settings, now()) : null;
}

function findProject(name: string | null | undefined): ProjectBranches | null {
  return (name && branchData?.find((p) => p.project === name)) || null;
}

function branchContext(): BranchContext {
  return {
    ...rowContext(),
    lastFullAt: lastFullDocTime,
    viewAction,
    viewError: (p) => bvErrors.get(p) ?? null,
    viewRunning: (p) => bvRunning?.project === p,
  };
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
      fullRepoMap = fullRepos(doc);
      lastFullDocTime = doc.time ?? new Date().toISOString();
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
  computeBranches();
  if (pendingBranchName && branchData) {
    const hit = branchData.flatMap((p) => p.groups).find((g) => g.name === pendingBranchName);
    if (hit) branchSelected = bBranchKey(hit.project, hit.name);
    pendingBranchName = null;
  }
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
  $("view-branches").textContent = branchesTabLabel(doc, branchData ? branchCounts(branchData) : null);
  document.querySelectorAll<HTMLElement>("#filter-chips [data-filter]").forEach((b) => {
    const on = b.dataset.filter === filter;
    b.setAttribute("aria-checked", String(on));
    // One tab stop for the group (radio pattern); ←/→ move between the chips
    b.tabIndex = on ? 0 : -1;
  });
  // The slot filter belongs to the slot screen; the branch screen brings its own
  $("filter-chips").hidden = view !== "slots";
  const branchesOn = view === "branches" && hasRepos(doc);
  $("branch-chips").hidden = !branchesOn;
  document.querySelectorAll<HTMLElement>("#branch-chips [data-bfilter]").forEach((b) => {
    const on = b.dataset.bfilter === branchFilter;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const hidden = $("branch-hidden");
  const hiddenCount = branchList?.hidden ?? 0;
  hidden.hidden = !branchesOn || hiddenCount === 0 || branchFilter === "all";
  hidden.textContent = t(branchFilter === "attention" ? "branches.hiddenClean" : "branches.hidden", { n: hiddenCount });
  hidden.title = t("branches.hiddenTitle");
  const slotChip = $("branch-slot");
  slotChip.hidden = !branchesOn || branchSlot === null;
  slotChip.textContent = t("branches.slotFilter", { slot: branchSlot ?? "" });
  slotChip.title = t("branches.slotFilterTitle");
  const pick = $("project-btn");
  pick.querySelector(".pick-label")!.textContent = project !== null ? projectLabel(project) : t("panel.allProjects");
  pick.classList.toggle("on", project !== null);
  pick.title = t("project.title");
}

function renderList() {
  paintList();
  // After the list: the tools show what it hid
  renderTools();
}

/** Ids for aria-activedescendant and the selection mark; scrolls the selection into view when asked. */
function markSelection(inner: HTMLElement, list: HTMLElement, key: string | null) {
  inner.querySelectorAll<HTMLElement>("[data-item]").forEach((el, i) => {
    el.id = `item-${i}`;
    const on = el.dataset.item === key;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-selected", String(on));
    if (on) {
      list.setAttribute("aria-activedescendant", el.id);
      if (revealSelection) el.scrollIntoView({ block: "nearest" });
    }
  });
  revealSelection = false;
}

/** Draws the list; items that moved slide to their new place, another screen fades in (motion.ts). */
function paintList() {
  const inner = $("list-inner");
  const before = lastScreen ? snapshotList(inner, lastScreen) : null;
  drawList();
  playList(inner, before, view);
  lastScreen = view;
}

function drawList() {
  const inner = $("list-inner");
  const list = $("list");
  list.removeAttribute("aria-activedescendant");
  if (!doc) {
    listView = null;
    branchList = null;
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
    if (!branchData) {
      // A core before 0.7.0: counts per repository, no names
      branchList = null;
      list.setAttribute("role", "region");
      list.setAttribute("aria-label", t("view.branchesLabel"));
      inner.innerHTML = oldCoreList(doc, project, rowContext());
      revealSelection = false;
      return;
    }
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", t("view.branchesLabel"));
    branchList = buildBranchList(branchData, { filter: branchFilter, project, slot: branchSlot, find: findText, collapsed: branchCollapsed });
    if (!slots().length) inner.innerHTML = `<p class="empty">${esc(t("empty.noSlots"))}</p>`;
    else if (!branchList.keys.length) inner.innerHTML = `<p class="empty">${esc(t("list.noBranchMatch"))}</p>`;
    else inner.innerHTML = branchListHtml(branchList, branchContext());
    markSelection(inner, list, branchSelected);
    return;
  }
  branchList = null;
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
  markSelection(inner, list, selected);
}

function unityButton(slot: Slot): UnityButton {
  const action = unityAction(slot);
  return action.kind === "focus" ? { kind: "focus" } : action;
}

function itemTitle(ref: ItemRef | null): string {
  if (!ref) return t("app.title");
  switch (ref.kind) {
    case "slot":
      return ref.name;
    case "group":
      return projectLabel(ref.name);
    case "extra":
      return extraTitle(doc?.unregisteredEditors?.length ?? 0, doc?.orphanWorkers?.length ?? 0);
    case "editor":
      return t("extra.editor", { pid: ref.pid });
    case "worker":
      return t("extra.worker", { pid: ref.pid });
  }
}

/** A project as the list would show it unfiltered (a selection the filter hides still has its details). */
function projectViewOf(pb: ProjectBranches): ProjectView {
  return (
    branchList?.projects.find((p) => p.pb.project === pb.project) ?? {
      pb,
      key: pb.project,
      collapsed: false,
      shown: pb.groups,
      hidden: 0,
      changes: pb.changes,
      changesCollapsed: false,
      stashes: pb.stashes,
      stashesCollapsed: false,
    }
  );
}

function branchBodyContent(): string {
  if (!branchData) return oldCoreBody(doc);
  const ref = parseBranchKey(branchSelected);
  const pb = findProject(ref?.project);
  if (ref && pb) {
    const ctx = branchContext();
    const pv = projectViewOf(pb);
    switch (ref.kind) {
      case "project":
        return projectBody(pv, ctx, project === pb.project);
      case "repo":
        return repoBody(pv, ctx);
      case "branch": {
        const g = pb.groups.find((x) => x.name === ref.name);
        if (g) return branchBody(g, pb, ctx);
        break;
      }
      case "changes":
        return subgroupBody(pv, "changes", ctx);
      case "stashes":
        return subgroupBody(pv, "stashes", ctx);
      case "change": {
        const item = pb.changes.find((c) => c.slot.name === ref.slot);
        if (item) return changeBody(item, ctx);
        break;
      }
      case "stash": {
        const item = pb.stashes.find((s) => s.repoKey === ref.repo && s.stash.index === ref.index);
        if (item) return stashBody(item, pb, ctx);
        break;
      }
    }
    return bodyMessage(t("body.gone"));
  }
  return bodyMessage(t("body.noBranchSelection"), { hint: t("body.branchesHint") });
}

function bodyContent(): string {
  if (!doc) return lastError ? errorMessage() : bodyMessage(t("footer.loading"));
  if (view === "branches") return branchBodyContent();
  if (!slots().length && !doc.unregisteredEditors?.length && !doc.orphanWorkers?.length) return bodyMessage(t("empty.noSlots"));
  const ref = selectedRef();
  const ctx = rowContext();
  switch (ref?.kind) {
    case "slot": {
      const slot = findSlot(ref.name);
      if (slot) return slotBody(slot, ctx, unityButton(slot), settings.openTarget, staleLease(slot));
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
  const title =
    view === "branches"
      ? ((branchData && branchItemTitle(parseBranchKey(branchSelected))) ?? t("view.branchesLabel"))
      : itemTitle(doc ? selectedRef() : null);
  // Long slot names shorten in the middle here too (the clone number stays)
  $("body-title").innerHTML = nameHtml(title, "title-name");
  $("sheet-title").innerHTML = nameHtml(title, "title-name");
  $("body-content").innerHTML = bodyContent();
  // Another item: the details fade in (a refresh of the same item does not)
  const bodyKey = `${view}|${doc ? (view === "branches" ? branchSelected : selected) : ""}`;
  if (bodyKey !== lastBodyKey) fadeIn($("body-content"));
  lastBodyKey = bodyKey;
}

function renderPanels() {
  const list = currentWarnings();
  const keep = focusedPanelProject();
  const projects = $("projects-body");
  projects.innerHTML = projectsPanel(doc, settings, warnedSlots(list), project, doc ? rowContext() : null, panelViewLine);
  // Every paint rebuilds the rows: the focused one keeps the focus (F2 renames it, Tab goes on from it)
  if (keep !== null) [...projects.querySelectorAll<HTMLElement>("[data-project]")].find((b) => b.dataset.project === keep)?.focus({ preventScroll: true });
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
  if (!items.length) {
    // Below what needs a person now: a view repository run that failed (it stays until the next run)
    const [failed] = [...bvErrors];
    if (!failed) return null;
    const [name, text] = failed;
    return {
      key: `bv:${name}:${text}`,
      message: t("bv.bannerFailed", { project: projectLabel(name), text }),
      warn: true,
      actions: [{ label: t("body.retry"), run: () => void runView(name) }],
    };
  }
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

/**
 * The folder a branch screen item opens in: a branch's checkout (else a copy with commits on no
 * remote, else the first), a slot's changes, a stash's slot, a project's first folder.
 */
function branchItemPath(key: string | null): string | null {
  const ref = parseBranchKey(key);
  const pb = findProject(ref?.project);
  if (!ref || !pb) return null;
  const slotPathOf = (name: string | undefined) => (name ? (pb.slots.find((s) => s.name === name)?.path ?? null) : null);
  switch (ref.kind) {
    case "branch": {
      const g = pb.groups.find((x) => x.name === ref.name);
      return g ? (branchHome(g, pb.slots)?.path ?? null) : null;
    }
    case "change":
      return slotPathOf(ref.slot);
    case "stash":
      return slotPathOf(pb.stashes.find((s) => s.repoKey === ref.repo && s.stash.index === ref.index)?.holders[0]);
    case "project":
    case "repo":
      return pb.repos[0]?.repo.folders?.[0]?.path ?? pb.slots[0]?.path ?? null;
    default:
      return null;
  }
}

/** `..\<name>` for the status bar; the full path is in the title and goes to the clipboard. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? `..\\${parts[parts.length - 1]}` : path;
}

/** The path of the selected item: a slot folder, or the project folder of an editor or worker. */
function selectedPath(): string | null {
  if (view === "branches") return branchItemPath(branchSelected);
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

// Each screen keeps its own selection and folded heads; these work on the screen in view.

function curSelected(): string | null {
  return view === "branches" ? branchSelected : selected;
}

function setCurSelected(key: string | null) {
  if (view === "branches") {
    branchSelected = key;
    writePref("branchSelected", key);
  } else {
    selected = key;
    writePref("selected", key);
  }
}

function curCollapsed(): Set<string> {
  return view === "branches" ? branchCollapsed : collapsed;
}

function saveCollapsed() {
  if (view === "branches") writePref("branchCollapsed", [...branchCollapsed]);
  else writePref("collapsedGroups", [...collapsed]);
}

function curKeys(): string[] {
  return (view === "branches" ? branchList?.keys : listView?.keys) ?? [];
}

/** The group key a slot screen selection sits in (a slot's project, the extra group of an editor or worker). */
function parentKey(ref: ItemRef | null): string | null {
  if (!ref) return null;
  if (ref.kind === "slot") {
    const slot = findSlot(ref.name);
    return slot ? groupKey(groupName(slot)) : null;
  }
  if (ref.kind === "editor" || ref.kind === "worker") return EXTRA_KEY;
  return null;
}

/** The head an item of the screen in view sits under. */
function curParent(key: string | null): string | null {
  if (!key) return null;
  return view === "branches" ? branchParentKey(key) : parentKey(parseKey(key));
}

/** A head that folds (a project, the extra group; on the branch screen also changes and stashes). */
function isFoldKey(key: string | null): boolean {
  if (!key) return false;
  if (view === "branches") return isBranchFoldKey(key);
  const ref = parseKey(key);
  return ref?.kind === "group" || ref?.kind === "extra";
}

/** `key` lies somewhere under the head `head`. */
function isUnder(key: string | null, head: string): boolean {
  for (let p = curParent(key); p; p = curParent(p)) if (p === head) return true;
  return false;
}

/**
 * Selects an item of the screen in view. `open` shows the details over the list when the details
 * column is not on screen (a press on a row: pressing the open one again closes them). `reveal`
 * scrolls it into view.
 */
function select(key: string | null, opts: { open?: boolean; reveal?: boolean } = {}) {
  const same = key === curSelected();
  setCurSelected(key);
  // An item in a folded head (picked from a panel): unfold its heads
  let unfolded = false;
  for (let p = curParent(key); p; p = curParent(p)) if (curCollapsed().delete(p)) unfolded = true;
  if (unfolded) saveCollapsed();
  if (opts.open && sheetMode()) setSheet(same ? !sheetOpen : true);
  revealSelection = opts.reveal === true;
  // First look at a slot: bring the detailed git state if it is old
  if (view === "slots" && parseKey(key)?.kind === "slot" && !same) freshenFull();
  render();
}

function moveSelection(to: "next" | "prev" | "first" | "last") {
  const keys = curKeys();
  if (!keys.length) return;
  const current = curSelected();
  const i = current ? keys.indexOf(current) : -1;
  const index =
    to === "first" ? 0 : to === "last" ? keys.length - 1 : to === "next" ? Math.min(keys.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
  select(keys[index], { reveal: true });
}

function toggleGroup(key: string, open?: boolean) {
  const set = curCollapsed();
  const fold = open === undefined ? !set.has(key) : !open;
  if (fold) set.add(key);
  else set.delete(key);
  saveCollapsed();
  // The selection inside a head that folds moves to the head
  if (fold && isUnder(curSelected(), key)) setCurSelected(key);
  render();
}

/** ←/→ on the list: fold, unfold, go to the head or into it (tree pattern). */
function stepTree(right: boolean): boolean {
  const key = curSelected();
  if (!key || !curKeys().length) return false;
  if (isFoldKey(key)) {
    const isCollapsed = curCollapsed().has(key);
    if (!right && !isCollapsed) toggleGroup(key, false);
    else if (right && isCollapsed) toggleGroup(key, true);
    else if (right) {
      const keys = curKeys();
      const next = keys[keys.indexOf(key) + 1];
      if (next && curParent(next) === key) select(next, { reveal: true });
    } else {
      // A folded head inside another (changes, stashes): ← goes up
      const parent = curParent(key);
      if (parent) select(parent, { reveal: true });
    }
    return true;
  }
  if (!right) {
    const parent = curParent(key);
    if (parent) select(parent, { reveal: true });
  }
  return true;
}

function setFilter(next: SlotFilter) {
  filter = next;
  writePref("slotFilter", next);
  render();
}

function setBranchFilter(next: BranchFilter) {
  branchFilter = next;
  writePref("branchFilter", next);
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
  // 「이 슬롯 브랜치 보기」 lasts while the branch screen is on
  if (view !== "branches") branchSlot = null;
  setSheet(false);
  paintViewTabs();
  // The branch screen reads the detailed git state: bring it when it is old
  if (view === "branches") freshenFull();
  revealSelection = true;
  render();
}

function stepView(delta: number) {
  selectView(VIEWS[(VIEWS.indexOf(view) + delta + VIEWS.length) % VIEWS.length]);
}

function clearFind() {
  findText = "";
  ($("find-input") as HTMLInputElement).value = "";
}

/**
 * 「이 슬롯 브랜치 보기」: the branch screen on the slot's project, only what the slot has, its
 * checked-out branch selected (the repository row before core 0.7.0 data is there).
 */
function showSlotBranches(slot: Slot) {
  const name = groupName(slot);
  branchSlot = slot.name;
  project = name;
  writePref("projectFilter", project);
  if (findText) clearFind();
  const git = gitOf(slot);
  const branch = git?.detached || git?.branch === "(detached)" ? detachedName({ slot: slot.name, path: slot.path }) : git?.branch;
  const pb = findProject(name);
  const hit = branch && pb?.groups.some((g) => g.name === branch);
  branchSelected = hit ? bBranchKey(name, branch!) : bRepoKey(name);
  writePref("branchSelected", branchSelected);
  // The selection sits under the project head: a folded one opens
  if (branchCollapsed.delete(bProjectKey(name))) writePref("branchCollapsed", [...branchCollapsed]);
  const g = hit ? pb!.groups.find((x) => x.name === branch) : null;
  // A clean branch is hidden by the 「주의」 filter: show every branch for now (the saved filter stays)
  if (g && g.level === "clean" && branchFilter === "attention") {
    branchFilter = "all";
  }
  revealSelection = true;
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
    clearFind();
    if (project !== null && (owner === null || owner !== project)) {
      project = null;
      writePref("projectFilter", null);
    }
  }
  select(key, { reveal: true });
}

/** Shows a branch screen item whatever the filters (a press in the warnings panel). */
function revealBranch(key: string) {
  if (view !== "branches") selectView("branches");
  const ref = parseBranchKey(key);
  if (!ref) return;
  branchSlot = null;
  if (findText) clearFind();
  if (project !== null && project !== ref.project) {
    project = null;
    writePref("projectFilter", null);
  }
  if (ref.kind === "branch") {
    const g = findProject(ref.project)?.groups.find((x) => x.name === ref.name);
    if (g && g.level === "clean" && branchFilter === "attention") branchFilter = "all";
    if (g && branchFilter === "checkedout" && !g.checkedOut) branchFilter = "all";
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

/** ←/→ fold heads only when the list itself has the focus (the chips use them too). */
function treeKeysActive(): boolean {
  if (isContextMenuOpen()) return false;
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
  const text = cleanupRequest(doc, now(), gitOf, scope, currentRepos());
  if (!text) {
    flashStatus(t("toast.cleanupEmpty"));
    return;
  }
  if (await copyText(text)) flashStatus(t("toast.cleanupCopied"), 3500);
}

// ---------------------------------------------------------------- project nicknames

/**
 * Asks for a project's nickname (src/aliases.ts) and stores it in widget.json. Saving it empty
 * shows the core's name again. Only the screens change; filters and copied text keep the name.
 */
async function renameProject(name: string) {
  const current = projectAlias(name) ?? "";
  const entered = await showPrompt({
    title: t("rename.title"),
    message: t("rename.message", { name }),
    value: current,
    placeholder: name,
    maxLength: ALIAS_MAX_CHARS,
    confirmLabel: t("rename.save"),
    cancelLabel: t("dialog.cancel"),
  });
  if (entered === null) return;
  const alias = cleanAlias(entered);
  if (alias === current || (alias === name && current === "")) return;
  try {
    receiveAliases(await call<Record<string, string>>("set_project_alias", { project: name, alias }));
  } catch (error) {
    flashStatus(t("rename.failed", { text: String(error) }), 5000);
    return;
  }
  const shown = projectAlias(name);
  flashStatus(shown ? t("rename.done", { name, alias: shown }) : t("rename.cleared", { name }), 3500);
  render();
}

/**
 * F2: the project being pointed at. A side panel project row with the focus comes first (「전체」
 * is none); then the selected project head in the list (the slot screen's group, the branch
 * screen's project or repository row). Pressing a project in the side panel filters the list but
 * leaves the selection where it was: a selection the list does not show gives way to the filter.
 */
function renameSelectedProject(): boolean {
  if (!doc) return false;
  const panel = focusedPanelProject();
  const name = panel !== null ? panel : selectedHeadProject();
  if (!name) return false;
  void renameProject(name);
  return true;
}

/** The side panel's project row with the focus: its project, "" for 「전체」, null when none has it. */
function focusedPanelProject(): string | null {
  const el = document.activeElement;
  const row = el instanceof HTMLElement ? el.closest<HTMLElement>("#projects-body [data-project]") : null;
  return row ? (row.dataset.project ?? "") : null;
}

/** The selected head's project, or the filtered project when the list does not show the selection. */
function selectedHeadProject(): string | null {
  const key = curSelected();
  const keys = (view === "branches" ? branchList?.keys : listView?.keys) ?? [];
  if (key === null || !keys.includes(key)) return project;
  if (view === "branches") {
    const ref = parseBranchKey(key);
    return ref?.kind === "project" || ref?.kind === "repo" ? ref.project : null;
  }
  const ref = parseKey(key);
  return ref?.kind === "group" ? ref.name : null;
}

/** Nicknames from widget.json; the screens follow when they changed (someone may edit the file). */
async function loadAliases() {
  const map = await call<Record<string, string>>("get_project_aliases").catch(() => null);
  if (map && receiveAliases(map) && doc) render();
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

// ---------------------------------------------------------------- stale lease (core `release -Stale`)

/** The slot whose stale lease is being released (one at a time, like core.rs RELEASING). */
let releasing: string | null = null;

/**
 * The release item of a slot: null when its lease is not stale (the core's `lease.stale`; older cores
 * have none, so no item), else off with a reason, or on.
 */
function staleLease(slot: Slot): StaleLeaseButton | null {
  if (slot.lease?.stale !== true) return null;
  if (lastResult?.source === "sample") return { off: t("unity.offSample") };
  if (releasing) return { off: t("lease.releasing") };
  return { off: null };
}

function leaseError(code: string): string {
  const [kind, ...rest] = code.split(":");
  switch (kind) {
    case "busy":
      return t("lease.releasing");
    case "core-not-found":
      return t("error.core-not-found");
    case "sample":
      return t("unity.offSample");
    case "timeout":
      return t("toast.unityTimeout");
    case "refused":
      return t("lease.refused", { reason: rest.join(":") });
    case "changed":
      return t("lease.changed");
    case "exit":
      return t("lease.failed", { text: rest.slice(1).join(":") || code });
    default:
      return t("lease.failed", { text: rest.join(":") || code });
  }
}

/** Asks, then runs `unity-slot release <slot> -Stale`: the core checks again and never touches an editor. */
async function releaseStale(slot: Slot) {
  const action = staleLease(slot);
  const lease = slot.lease;
  if (!action || !lease) return;
  if (action.off) {
    flashStatus(action.off, 4000);
    return;
  }
  const why = lease.expired
    ? t("lease.whyExpired", { time: formatWhen(lease.expiresAt, now()) })
    : t("lease.whyClientGone", { name: lease.client?.name ?? "?", pid: lease.client?.pid ?? "?" });
  const ok = await showDialog({
    title: t("lease.releaseTitle", { slot: slot.name }),
    message: t("lease.releaseMessage", { owner: lease.owner, why }),
    detail: `unity-slot release ${slot.name} -Stale`,
    confirmLabel: t("lease.releaseConfirm"),
    cancelLabel: t("dialog.cancel"),
  });
  if (!ok) return;
  releasing = slot.name;
  render();
  flashStatus(t("lease.releasing"), 30_000);
  try {
    const r = await call<ReleaseResult>("release_stale_lease", { slot: slot.name });
    flashStatus(t(r.outcome === "not-leased" ? "lease.notLeased" : "lease.released", { slot: slot.name }), 4000);
  } catch (e) {
    flashStatus(leaseError(String(e)), 6000);
  } finally {
    releasing = null;
  }
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

async function openPath(path: string, target: OpenTarget) {
  try {
    await call("open_with", { path, target });
  } catch (e) {
    flashStatus(openError(String(e), target), 4000);
  }
}

/** The cleanup request for one branch's copies (branch screen). */
async function copyBranchCleanup(projectName: string, name: string) {
  const g = findProject(projectName)?.groups.find((x) => x.name === name);
  if (!g || !doc) return;
  if (await copyText(branchCleanupRequest(g, slots(), now(), doc.time))) flashStatus(t("toast.cleanupCopied"), 3500);
}

// ---------------------------------------------------------------- view repository (core 0.7.0 branch-view)

/** What the view repository button of a project does, or why it is off. */
function viewAction(pb: ProjectBranches): ViewAction {
  const kind = pb.view?.path && !pb.view.error ? "open" : "create";
  let off: string | null = null;
  if (lastResult?.source === "sample") off = t("bv.offSample");
  else if (!hasBranchViews(doc)) off = t("bv.offCore", { version: doc?.version ?? "?" });
  else if (bvRunning) off = t(bvRunning.project === pb.project ? "bv.running" : "bv.offBusy");
  else if (kind === "create" && pb.slots.length < 2) off = t("bv.offOneSlot");
  return { kind, off };
}

/** The label of the button: make it, or refresh it (and open it in Fork when the setting says so). */
function viewButtonLabel(action: ViewAction, short = false): string {
  if (action.kind === "create") return t(short ? "bv.createShort" : "bv.create");
  if (!settings.branchViewOpenFork) return t(short ? "bv.refreshShort" : "bv.refresh");
  return t(short ? "bv.openShort" : "bv.openAll");
}

/** Side panel [P]: 「보기용 11:20 [Fork]」 or 「보기용 없음 [만들기…]」 under a project (core 0.7.0). */
function panelViewLine(name: string, members: Slot[]): string {
  const pb = findProject(name);
  if (!pb || !hasRepos(doc) || (!pb.view && members.length < 2)) return "";
  const line = viewLine(pb, branchContext());
  const action = viewAction(pb);
  return `<div class="view-line"><span class="grow${line.tone ? ` ${line.tone}-text` : ""}" title="${esc(pb.view?.path ?? "")}">${esc(line.text)}</span><button type="button" class="link-btn" data-bv="${esc(
    name,
  )}"${action.off ? ` disabled title="${esc(action.off)}"` : ` title="${esc(t(action.kind === "create" ? "bv.createTitle" : "bv.openAllTitle"))}"`}>${esc(viewButtonLabel(action, true))}</button></div>`;
}

function bvErrorText(code: string): string {
  const [kind, ...rest] = code.split(":");
  const text = rest.join(":");
  switch (kind) {
    case "sample":
      return t("bv.offSample");
    case "busy":
      return t("bv.offBusy");
    case "core-not-found":
      return t("error.core-not-found");
    case "bad-project":
      return t("bv.badProject");
    case "parse":
      return t("error.parse");
    case "spawn":
      return t("error.spawn", { text });
    case "exit":
      return t("bv.exit", { text: rest.slice(1).join(":") || text });
    default:
      return code;
  }
}

/** The plan or result entry for a project in a `branch-view -Json` document. */
function viewEntry(result: BranchViewResult, registry: string): BranchViewPlan | null {
  const views = result.document.views ?? [];
  return views.find((v) => (v.project ?? "").toLowerCase() === registry.toLowerCase()) ?? views[0] ?? null;
}

/** Why a plan or a run did not do its work, or null. */
function viewProblem(entry: BranchViewPlan | null, result: BranchViewResult): string | null {
  if (!entry) return t("bv.noEntry");
  if (entry.action === "skip") return t("bv.skipped", { reason: entry.reason ?? "" });
  if (entry.action === "busy" || result.exitCode === 4) return t("bv.busyCore");
  if (entry.action === "error" || entry.error) return entry.error ?? t("bv.noEntry");
  return null;
}

function failView(name: string, text: string) {
  bvErrors.set(name, text);
  flashStatus(t("bv.failed", { text }), 6000);
}

/** A run ended: refresh the dashboard (its branchViews), say what happened, open Fork. */
async function finishView(name: string, registry: string, result: BranchViewResult) {
  const entry = viewEntry(result, registry);
  const problem = viewProblem(entry, result);
  void refresh(false);
  if (problem || !entry) {
    failView(name, problem ?? t("bv.noEntry"));
    return;
  }
  bvErrors.delete(name);
  const fetched = (entry.slots ?? []).filter((s) => s.action === "fetched").length;
  const failed = (entry.slots ?? []).filter((s) => s.action === "failed" || s.status === "failed").length;
  flashStatus(t(failed ? "bv.doneFailed" : "bv.done", { project: projectLabel(name), n: fetched, failed }), 5000);
  if (settings.branchViewOpenFork && entry.path) await openPath(entry.path, "fork");
}

/** The confirmation before a view repository is made: where, how many slots, how big, what it is not. */
function confirmCreate(name: string, entry: BranchViewPlan): Promise<boolean> {
  const slotNames = (entry.slots ?? []).map((s) => s.slot);
  const detail = [
    t("bv.detailPath", { path: entry.path ?? "?" }),
    t("bv.detailSlots", { n: slotNames.length, list: slotNames.join(", ") }),
    t("bv.detailSize", { size: formatSize(entry.estimatedBytes) }),
    t("bv.detailReadOnly"),
    t("bv.detailNotBackup"),
  ].join("\n");
  return showDialog({
    title: t("bv.confirmTitle", { project: projectLabel(name) }),
    message: t("bv.confirmMessage", { n: slotNames.length }),
    detail,
    confirmLabel: t("bv.confirmCreate"),
    cancelLabel: t("dialog.cancel"),
  });
}

/**
 * The view repository button (a person pressed it): without a view, plan first (`branch-view -Json`,
 * writes nothing) and ask; then `-Apply` (incremental when it exists) and open it in Fork. Never
 * while sample data is shown or with a core before 0.7.0. A run past the time limit goes on; its
 * result comes as `branch-view-finished`.
 */
async function runView(name: string) {
  const pb = findProject(name);
  if (!pb) return;
  const action = viewAction(pb);
  if (action.off) {
    flashStatus(action.off, 4000);
    return;
  }
  const registry = pb.slots.find((s) => s.project)?.project ?? name;
  bvErrors.delete(name);
  bvRunning = { project: name, registry };
  render();
  let late = false;
  try {
    if (action.kind === "create") {
      flashStatus(t("bv.planning", { project: projectLabel(name) }), 60_000);
      const plan = await call<BranchViewResult>("branch_view", { project: registry, apply: false });
      const entry = viewEntry(plan, registry);
      const problem = viewProblem(entry, plan);
      if (problem || !entry) {
        failView(name, problem ?? t("bv.noEntry"));
        return;
      }
      flashStatus("", 1);
      // The plan can find a view the dashboard did not know (made elsewhere): then no question
      if (!entry.exists && !(await confirmCreate(name, entry))) {
        flashStatus(t("bv.cancelled"));
        return;
      }
    }
    flashStatus(t(action.kind === "create" ? "bv.creating" : "bv.refreshing", { project: projectLabel(name) }), 200_000);
    const result = await call<BranchViewResult>("branch_view", { project: registry, apply: true });
    bvRunning = null;
    await finishView(name, registry, result);
  } catch (e) {
    const code = String(e);
    if (code === "timeout") {
      // Still running in the core (never killed): the button stays off until it ends
      late = true;
      flashStatus(t("bv.slow", { project: projectLabel(name) }), 10_000);
      return;
    }
    failView(name, bvErrorText(code));
  } finally {
    if (!late) bvRunning = null;
    render();
  }
}

/** A run that outlasted the time limit ended (lib.rs `branch_view`). */
function onViewFinished(payload: { project: string; apply: boolean; result?: BranchViewResult; error?: string }) {
  const running = bvRunning;
  if (!running || running.registry !== payload.project) return;
  bvRunning = null;
  if (payload.result && payload.apply) void finishView(running.project, running.registry, payload.result).then(render);
  else {
    // A plan that ended late made nothing and asked nothing: the person presses again
    failView(running.project, payload.error ? bvErrorText(payload.error) : payload.apply ? t("bv.noEntry") : t("bv.latePlan"));
    render();
  }
}

// ---------------------------------------------------------------- branch screen menus

function branchMenu(key: string): MenuEntry[] {
  const ref = parseBranchKey(key);
  const pb = findProject(ref?.project);
  if (!ref || !pb) return [];
  const target = settings.openTarget;
  const openLabel = t("menu.open", { app: t(`open.${target}`) });
  const pathOf = (name: string | null | undefined) => (name ? (pb.slots.find((s) => s.name === name)?.path ?? null) : null);
  const foldItem = (k: string): MenuEntry => ({ label: t(branchCollapsed.has(k) ? "menu.unfold" : "menu.fold"), shortcut: "Enter", action: () => toggleGroup(k) });
  const folderItems = (path: string | null): MenuEntry[] =>
    path
      ? [
          { label: openLabel, shortcut: "Ctrl+O", action: () => void openPath(path, target) },
          ...(target !== "explorer" ? [{ label: t("menu.openExplorer"), action: () => void openFolder(path) }] : []),
        ]
      : [];
  switch (ref.kind) {
    case "project":
      return [
        foldItem(key),
        { label: t(project === pb.project ? "group.showAll" : "group.onlyThis"), action: () => setProject(project === pb.project ? null : pb.project) },
        { label: t("menu.rename"), shortcut: "F2", action: () => void renameProject(pb.project) },
        "separator",
        { label: t("menu.cleanupScope", { scope: projectLabel(pb.project) }), action: () => void copyCleanup(projectScope(pb.project)) },
      ];
    case "repo": {
      const action = viewAction(pb);
      const viewPath = pb.view?.path;
      return [
        ...folderItems(pb.repos[0]?.repo.folders?.[0]?.path ?? pb.slots[0]?.path ?? null),
        "separator",
        { label: viewButtonLabel(action), disabled: action.off !== null, action: () => void runView(pb.project) },
        ...(viewPath ? [{ label: t("bv.openFork"), action: () => void openPath(viewPath, "fork") }] : []),
        "separator",
        { label: t("menu.rename"), shortcut: "F2", action: () => void renameProject(pb.project) },
        { label: t("menu.cleanupScope", { scope: projectLabel(pb.project) }), action: () => void copyCleanup(projectScope(pb.project)) },
      ];
    }
    case "branch": {
      const g = pb.groups.find((x) => x.name === ref.name);
      if (!g) return [];
      const entries: MenuEntry[] = [{ label: t("branch.copyName"), shortcut: "Ctrl+C", action: () => void copyPath(g.name) }];
      // Every folder that has it checked out; several make one item each
      const outs = [...new Map(g.copies.flatMap((c) => c.checkouts).map((k) => [k.path, k])).values()];
      if (outs.length > 1) {
        for (const k of outs) entries.push({ label: t("branch.openIn", { app: t(`open.${target}`), slot: k.slot ?? k.path }), action: () => void openPath(k.path, target) });
      } else {
        const home = branchHome(g, pb.slots);
        entries.push(...folderItems(home?.path ?? null));
      }
      entries.push("separator", { label: t("branch.cleanup"), action: () => void copyBranchCleanup(pb.project, g.name) });
      const viewPath = pb.view?.path;
      const ref2 = g.copies.map((c) => viewRef(pb.view, c)).find((r): r is string => !!r);
      if (ref2 || viewPath) entries.push("separator");
      if (ref2) entries.push({ label: t("bv.copyRef"), action: () => void copyPath(ref2) });
      if (viewPath) entries.push({ label: t("bv.openFork"), action: () => void openPath(viewPath, "fork") });
      return entries;
    }
    case "changes":
    case "stashes":
      return [foldItem(key)];
    case "change": {
      const path = pathOf(ref.slot);
      return path ? [...folderItems(path), "separator", { label: t("btn.copyPath"), action: () => void copyPath(path) }] : [];
    }
    case "stash": {
      const item = pb.stashes.find((s) => s.repoKey === ref.repo && s.stash.index === ref.index);
      if (!item) return [];
      return [...folderItems(pathOf(item.holders[0])), "separator", { label: t("branch.copyMessage"), action: () => void copyPath(item.stash.message ?? "") }];
    }
  }
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
  ];
  const stale = staleLease(slot);
  if (stale) {
    entries.push({
      label: stale.off ? t("menu.releaseStaleOff", { reason: stale.off }) : t("menu.releaseStale"),
      disabled: stale.off !== null,
      action: () => void releaseStale(slot),
    });
  }
  entries.push(
    "separator",
    { label: t("menu.open", { app: t(`open.${target}`) }), shortcut: "Ctrl+O", action: () => void openSlot(slot, target) },
  );
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
    { label: t("menu.rename"), shortcut: "F2", action: () => void renameProject(name) },
    "separator",
    { label: t("menu.cleanupScope", { scope: projectLabel(name) }), action: () => void copyCleanup(projectScope(name)) },
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
  return project === null ? t("menu.cleanup") : t("menu.cleanupScope", { scope: projectLabel(project) });
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
    ...[...projectGroups(slots()).keys()].map((name): MenuEntry => ({ label: projectLabel(name), checked: project === name, action: () => setProject(name) })),
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
    const key = pick.dataset.pickItem ?? slotKey(pick.dataset.pick!);
    // A row of the branch screen's changes or stash head stays on the branch screen
    if (isBranchKey(key)) {
      if (view === "branches") select(key, { reveal: true });
      else revealBranch(key);
    } else reveal(key);
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
    case "release-stale":
      if (slot) void releaseStale(slot);
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
    case "rename-project":
      if (data.project) void renameProject(data.project);
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
    case "open-path":
      if (data.path) void openPath(data.path, (OPEN_TARGETS as readonly string[]).includes(data.target ?? "") ? (data.target as OpenTarget) : settings.openTarget);
      break;
    case "bv-run":
      if (data.project) void runView(data.project);
      break;
    case "branch-cleanup":
      if (data.project && data.name) void copyBranchCleanup(data.project, data.name);
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
  if (key !== curSelected()) select(key);
  const entries = menuFor(key);
  if (entries.length) showContextMenu(e, entries);
}

/** The right-click menu of an item of the screen in view. */
function menuFor(key: string | null): MenuEntry[] {
  if (!key) return [];
  return view === "branches" ? (isBranchKey(key) ? branchMenu(key) : []) : itemMenu(parseKey(key));
}

function openRowMenu(): boolean {
  if (!curSelected() || !listKeysActive()) return false;
  const entries = menuFor(curSelected());
  if (!entries.length) return false;
  const row = document.querySelector<HTMLElement>("#list-inner [data-item].selected");
  const r = (row ?? $("list")).getBoundingClientRect();
  showContextMenu({ x: r.left + 24, y: r.top + Math.min(r.height, 28) }, entries);
  return true;
}

function onEnter(): boolean {
  const el = document.activeElement;
  const key = curSelected();
  if (!key || !listKeysActive() || !curKeys().length || (el && el.closest("button, a"))) return false;
  if (isFoldKey(key)) {
    toggleGroup(key);
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
  $("branch-chips").addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>("[data-bfilter]")?.dataset.bfilter;
    if (isBranchFilter(value)) setBranchFilter(value);
  });
  $("branch-chips").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : BRANCH_FILTERS.length - 1;
    const next = BRANCH_FILTERS[(BRANCH_FILTERS.indexOf(branchFilter) + step) % BRANCH_FILTERS.length];
    setBranchFilter(next);
    document.querySelector<HTMLElement>(`#branch-chips [data-bfilter="${next}"]`)?.focus();
  });
  // 「깨끗 24 숨김」: show every branch
  $("branch-hidden").addEventListener("click", () => setBranchFilter("all"));
  // The slot filter chip clears it
  $("branch-slot").addEventListener("click", () => {
    branchSlot = null;
    render();
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
    const bv = target.closest<HTMLElement>("[data-bv]");
    if (bv) {
      void runView(bv.dataset.bv!);
      return;
    }
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
  $("warnings-body").addEventListener("click", (e) => {
    const branch = (e.target as HTMLElement).closest<HTMLElement>("[data-branch]")?.dataset.branch;
    if (branch) revealBranch(branch);
    else pickSlot(e);
  });
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

  const inList = (fn: () => void) => () => listKeysActive() && (fn(), true);
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
        // A branch copies its name; anything else its folder
        const ref = view === "branches" ? parseBranchKey(branchSelected) : null;
        const path = ref?.kind === "branch" ? ref.name : selectedPath();
        // Selected text copies as usual
        if (!path || (window.getSelection()?.toString() ?? "") !== "") return false;
        void copyPath(path);
      },
    },
    {
      keys: "Ctrl+O",
      run: () => {
        if (view === "branches") {
          const path = selectedPath();
          if (path) void openPath(path, settings.openTarget);
          return;
        }
        const slot = selectedSlot();
        if (slot) void openSlot(slot, settings.openTarget);
      },
    },
    { keys: "F2", run: renameSelectedProject },
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
  // A branch screen key (bb:..., br:...) selects there; anything else on the slot screen
  if (pick !== null && isBranchKey(pick)) branchSelected = pick;
  else if (pick !== null) selected = pick ? (/^[sgxew]:/.test(pick) ? pick : slotKey(pick)) : null;
  // ?branch=<name>: that branch once the data is there; ?bfilter=attention|checkedout|all; ?bslot=<slot>
  pendingBranchName = query.get("branch");
  const bf = query.get("bfilter");
  if (isBranchFilter(bf)) branchFilter = bf;
  branchSlot = query.get("bslot") || null;
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
  receiveAliases(await call<Record<string, string>>("get_project_aliases").catch(() => null));
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
  const reloadSettings = () => {
    void call<WidgetSettings>("get_settings").then(receiveSettings).catch(() => {});
    void loadAliases();
  };
  // Back from the tray: settings may have changed meanwhile; refresh unless one just ended
  await on("widget-shown", () => {
    reloadSettings();
    if (Date.now() - refreshedAt > 5000) void refresh(false);
  });
  // widget.json changed (here or by someone else): what the file holds now applies
  await on("settings-file-changed", reloadSettings);
  // The tray menu's Settings
  await on("open-settings", () => openSettings());
  // A view repository run that outlasted the time limit ended
  await on("branch-view-finished", onViewFinished);

  window.setInterval(tick, 1000);
  void refresh(true);
}

void boot();
