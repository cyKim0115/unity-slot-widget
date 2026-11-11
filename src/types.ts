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
}

export interface GitState {
  level?: "basic" | "full";
  branch?: string | null;
  upstream?: string | null;
  upstreamGone?: boolean | null;
  changes?: number | null;
  ahead?: number | null;
  behind?: number | null;
  lastFetchAt?: string | null;
  commonDir?: string | null;
  localOnly?: { commits?: number | null; oldestAt?: string | null } | null;
  branches?: { total?: number | null; noUpstream?: number | null; upstreamGone?: number | null } | null;
  stash?: number | null;
  /** Other working folders of the same repository: paths (core 0.4) or `{ path, branch }`. */
  worktrees?: (string | { path: string; branch?: string | null })[] | null;
  error?: string | null;
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

/** Programs a slot folder can be opened with (right-click > Open). The first is the default. */
export const OPEN_TARGETS = ["fork", "cmd", "git_bash", "cursor", "vscode", "explorer"] as const;
export type OpenTarget = (typeof OPEN_TARGETS)[number];

export interface WidgetSettings {
  language: "auto" | "ko" | "en";
  alwaysOnTop: boolean;
  glass: boolean;
  glassBlur: number;
  idleSecs: number;
  startingSecs: number;
  gitFullMins: number;
  signalSecs: number;
  commitWarnPercent: number;
  commitCriticalPercent: number;
  slotMemoryWarnGb: number;
  localOnlyWarnDays: number;
  localOnlyCriticalDays: number;
  openTarget: OpenTarget;
  unitySlotScript: string;
  sampleFile: string;
}

export interface CoreLocation {
  script?: string | null;
  source: "setting" | "env" | "install.json" | "path" | "none";
  slotHome: string;
}

/** The schema major version this widget understands. */
export const SUPPORTED_SCHEMA_MAJOR = 1;
