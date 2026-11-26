/**
 * `unity-slot dashboard -Json` document, schema `unity-slot.dashboard/1`.
 * The core owns this contract. Every field the widget reads is optional here so an older or
 * newer core never breaks the page: missing values are drawn as "-".
 */

export type EditorState = "closed" | "starting" | "ready" | "stalled" | "unknown" | "batch" | "missing";

export interface Memory {
  editorPrivGB?: number;
  workersPrivGB?: number;
  childrenPrivGB?: number;
  totalPrivGB?: number;
  totalWsGB?: number;
  workers?: number;
  children?: number;
}

export interface Editor {
  state: EditorState;
  pid?: number | null;
  startedAt?: string | null;
  readyAt?: string | null;
  readySeconds?: number | null;
  launch?: "direct" | "hub" | string | null;
  standby?: string | null;
  lock?: "none" | "held" | "stale" | string | null;
  unsavedScene?: boolean | null;
  memory?: Memory | null;
}

export interface Lease {
  owner: string;
  need?: string | null;
  acquiredAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  openedByAcquire?: boolean;
  host?: string | null;
  /** The MCP client process that took the lease (core 0.5.5+); null for CLI and older leases. */
  client?: { name?: string | null; pid?: number | null; startedAt?: string | null; alive?: boolean | null } | null;
  /**
   * What `release <slot> -Stale` drops: no editor or batchmode run, and expired or its client gone.
   * The core decides; missing on older cores (then the widget offers no release).
   */
  stale?: boolean;
}

/** Commits on no remote: how many and the oldest one's time. */
export interface LocalOnly {
  commits?: number | null;
  oldestAt?: string | null;
}

/** `git.changesDetail` (core 0.7.0): an entry can be staged and unstaged at once, so the sum can exceed `changes`. */
export interface ChangesDetail {
  staged?: number | null;
  unstaged?: number | null;
  untracked?: number | null;
  conflicted?: number | null;
}

export interface GitState {
  level?: "basic" | "full";
  /** `(detached)` on a detached HEAD, as git reports it. */
  branch?: string | null;
  upstream?: string | null;
  upstreamGone?: boolean | null;
  changes?: number | null;
  ahead?: number | null;
  behind?: number | null;
  lastFetchAt?: string | null;
  commonDir?: string | null;
  localOnly?: LocalOnly | null;
  branches?: { total?: number | null; noUpstream?: number | null; upstreamGone?: number | null } | null;
  stash?: number | null;
  /** Other working folders of the same repository: paths (core 0.4) or `{ path, branch }`. */
  worktrees?: (string | { path: string; branch?: string | null })[] | null;
  error?: string | null;
  /** Core 0.7.0, with basic too: the HEAD commit, detached or not, the change kinds, the folder's own git directory. */
  head?: string | null;
  detached?: boolean | null;
  changesDetail?: ChangesDetail | null;
  gitDir?: string | null;
}

/** A working folder of a git directory (`repos[].folders[]`, from basic too: who has which branch checked out). */
export interface RepoFolder {
  path: string;
  /** The slot's name when the folder is registered. */
  slot?: string | null;
  main?: boolean | null;
  /** null on a detached HEAD. */
  branch?: string | null;
  head?: string | null;
  detached?: boolean | null;
  locked?: string | boolean | null;
  prunable?: string | boolean | null;
  /** Full and a detached HEAD only: commits that no branch and no remote has. */
  localOnly?: LocalOnly | null;
}

/** A local branch (`repos[].branches[]`, full only). */
export interface Branch {
  name: string;
  tip?: string | null;
  tipAt?: string | null;
  subject?: string | null;
  upstream?: string | null;
  upstreamGone?: boolean | null;
  /** Against the upstream; null without one or when it is gone. */
  ahead?: number | null;
  behind?: number | null;
  /** Against the default branch. */
  baseAhead?: number | null;
  baseBehind?: number | null;
  merged?: boolean | null;
  /** Commits on no remote reachable from the branch; null when the core could not count them. */
  localOnly?: LocalOnly | null;
  checkedOutBy?: { path: string; slot?: string | null }[] | null;
}

export interface Stash {
  /** 0 is the newest. */
  index: number;
  sha?: string | null;
  at?: string | null;
  /** From `On <branch>:` in the message: a guess. */
  branch?: string | null;
  message?: string | null;
}

/** One git directory (core 0.7.0 `repos[]`). The full-only fields are null with basic. */
export interface RepoGit {
  commonDir: string;
  project?: string | null;
  repo?: string | null;
  level?: "basic" | "full";
  layout?: "clone" | "worktrees" | "bare-hub" | string | null;
  hub?: string | null;
  lastFetchAt?: string | null;
  defaultBranch?: string | null;
  folders?: RepoFolder[] | null;
  branches?: Branch[] | null;
  stashes?: Stash[] | null;
  localOnly?: LocalOnly | null;
  flags?: string[] | null;
  error?: string | null;
}

/** A view repository's slot (`branchViews[].slots[]`). */
export interface BranchViewSlot {
  slot: string;
  remote?: string | null;
  /** fetched, unchanged, busy, missing, failed, not-fetched */
  status?: string | null;
  fetchedAt?: string | null;
  /** The slot's refs changed since the last fetch; null when unknown. */
  changedSince?: boolean | null;
  error?: string | null;
}

/** One view repository (core 0.7.0 `branchViews[]`): read from its state file, no git. */
export interface BranchView {
  /** The registry project, lower case. */
  project?: string | null;
  repo?: string | null;
  /** The bare view repository: what Fork opens. */
  path?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  coreVersion?: string | null;
  slots?: BranchViewSlot[] | null;
  origin?: {
    filledFrom?: string | null;
    /** origin refs left stale because the update was no fast-forward (force push, deleted upstream). */
    rejected?: { name: string; viewSha?: string | null; slotSha?: string | null }[] | null;
  } | null;
  error?: string | null;
}

/** A `views[]` entry of `branch-view -Json`: a dashboard entry plus the plan. */
export interface BranchViewPlan extends BranchView {
  name?: string | null;
  exists?: boolean | null;
  /** create, refresh, none, skip, busy, error */
  action?: string | null;
  reason?: string | null;
  remotes?: { add?: string[] | null; update?: string[] | null; remove?: string[] | null; conflict?: string[] | null } | null;
  sizeBytes?: number | null;
  estimatedBytes?: number | null;
  seconds?: number | null;
  slots?: (BranchViewSlot & { path?: string | null; action?: string | null; note?: string | null })[] | null;
}

/** `unity-slot branch-view -Json`, schema `unity-slot.branch-view/1`. */
export interface BranchViewDoc {
  schema: string;
  version?: string | null;
  apply?: boolean;
  root?: string | null;
  views?: BranchViewPlan[] | null;
}

/** What the `branch_view` command returns: the document and the core's exit code (1 when a view failed, 4 busy). */
export interface BranchViewResult {
  document: BranchViewDoc;
  exitCode: number;
}

export type SlotFlag =
  | "open-without-lease"
  | "lease-expired-open"
  | "lease-expiring"
  | "stalled"
  | "unsaved-scene"
  | "stale-lock"
  | "batch-running"
  | "missing-path"
  | "local-only-old"
  | "lease-client-gone"
  | string;

export interface Slot {
  name: string;
  path: string;
  project?: string | null;
  repo?: string | null;
  kind?: "clone" | "worktree" | string | null;
  unity?: string | null;
  platform?: string | null;
  purposes?: string[] | null;
  mode?: "hot" | "ondemand" | string | null;
  agentUse?: boolean | null;
  memo?: string | null;
  exists?: boolean | null;
  editor?: Editor | null;
  lease?: Lease | null;
  git?: GitState | null;
  lastOpenedAt?: string | null;
  lastClosedAt?: string | null;
  flags?: SlotFlag[] | null;
}

export interface UnregisteredEditor {
  pid: number;
  project?: string | null;
  startedAt?: string | null;
  launch?: string | null;
  memory?: Memory | null;
}

export interface OrphanWorker {
  pid: number;
  ownerPid?: number | null;
  project?: string | null;
  privGB?: number | null;
}

export interface SlotEvent {
  time: string;
  event: string;
  slot?: string | null;
  owner?: string | null;
  pid?: number | null;
  via?: string | null;
  detail?: Record<string, unknown> | null;
}

export type SystemFlag = "commit-high" | "commit-critical" | "editors-at-max" | string;

export interface Dashboard {
  schema: string;
  version?: string | null;
  time?: string | null;
  host?: string | null;
  registry?: { path?: string | null; updatedAt?: string | null; maxEditors?: number | null } | null;
  system?: {
    commit?: { usedGB?: number; limitGB?: number; percent?: number } | null;
    freePhysicalGB?: number | null;
    editorsOpen?: number | null;
  } | null;
  slots?: Slot[] | null;
  unregisteredEditors?: UnregisteredEditor[] | null;
  orphanWorkers?: OrphanWorker[] | null;
  recentEvents?: SlotEvent[] | null;
  systemFlags?: SystemFlag[] | null;
  timing?: { totalMs?: number; processMs?: number; gitMs?: number } | null;
  /** Core 0.7.0: one entry per git directory. No key means an older core; null for the summary. */
  repos?: RepoGit[] | null;
  /** Core 0.7.0: the view repositories `branch-view` made. */
  branchViews?: BranchView[] | null;
}

export interface DashboardResult {
  document: Dashboard;
  ms: number;
  source: "core" | "sample";
  script?: string | null;
}

/** `open_in_unity`: what `unity-slot open <slot> -NoWait` did. */
export interface OpenResult {
  outcome: "started" | "already-open" | "done" | string;
  pid?: number | null;
  /** `warn capacity: ...` lines from the core; it warns and opens anyway. */
  warnings?: string[] | null;
}

/** `release_stale_lease`: what `unity-slot release <slot> -Stale` did. */
export interface ReleaseResult {
  outcome: "released" | "not-leased" | string;
}

/** Programs a slot folder can be opened with (right-click > Open). The first is the default. */
export const OPEN_TARGETS = ["fork", "cmd", "git_bash", "cursor", "vscode", "explorer"] as const;
export type OpenTarget = (typeof OPEN_TARGETS)[number];

/** widget.json (src-tauri/src/settings.rs). Ranges and defaults: src/settings.ts. */
export interface WidgetSettings {
  language: "auto" | "ko" | "en";
  /** Main window always on top: the title bar pin (the old `alwaysOnTop` key is not read). */
  windowOnTop: boolean;
  /** The close box (X): quit the app, hide it to the tray, or leave the small widget of the open editors (src/mini). */
  closeAction: "quit" | "tray" | "widget";
  /** Started by Windows: show the window minimized (refreshes go on). */
  startMinimized: boolean;
  theme: "system" | "light" | "dark";
  /** Theme fade in ms, 0 to 1000. */
  themeDurationMs: number;
  idleSecs: number;
  startingSecs: number;
  gitFullMins: number;
  signalSecs: number;
  commitWarnPercent: number;
  commitCriticalPercent: number;
  slotMemoryWarnGb: number;
  localOnlyWarnDays: number;
  localOnlyCriticalDays: number;
  /** Flash the taskbar button when a new risk appears. */
  flashTaskbar: boolean;
  openTarget: OpenTarget;
  /** Open the branch view repository in Fork after refreshing it. */
  branchViewOpenFork: boolean;
  unitySlotScript: string;
  sampleFile: string;
}

/** `get_app_info`: what the settings About and Core tabs show. */
export interface AppInfo {
  version: string;
  settingsFile: string;
  slotHome: string;
  dev: boolean;
}

export interface CoreLocation {
  script?: string | null;
  source: "setting" | "env" | "install.json" | "path" | "none";
  slotHome: string;
}

/** The schema major version this widget understands. */
export const SUPPORTED_SCHEMA_MAJOR = 1;
