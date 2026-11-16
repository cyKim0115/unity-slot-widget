/**
 * Pure derivations from the dashboard document. The core already decides slot states and most
 * flags; the app adds only what depends on its own settings (commit, memory and local-only age
 * thresholds), merges the last full git result into basic refreshes, and groups slots that share
 * one git directory (commonDir: worktree slots of one repository) so the numbers they share are
 * counted once. It also orders what needs a person now (the banner; glance.ts uses the same rules
 * for the tray tooltip and the taskbar badge).
 */
import type { Dashboard, GitState, Slot, WidgetSettings } from "./types";
import { formatDuration, formatWhen, t } from "./i18n";

export type Severity = "critical" | "warn" | "info";

export interface Warning {
  severity: Severity;
  text: string;
  /** The slot it is about (the first one when it is about a shared repository). */
  slot?: string;
  /** Every slot it is about, when more than one (a repository that several slots share). */
  slots?: string[];
}

const DAY = 86_400_000;

/** Flags the app recomputes from its own settings, so the core's copy is skipped. */
const WIDGET_OWNED_FLAGS = new Set(["local-only-old", "commit-high", "commit-critical"]);

const FLAG_SEVERITY: Record<string, Severity> = {
  stalled: "critical",
  "lease-expired-open": "critical",
  "lease-client-gone": "warn",
  "missing-path": "critical",
  "open-without-lease": "warn",
  "unsaved-scene": "warn",
  "lease-expiring": "warn",
  "stale-lock": "warn",
  "editors-at-max": "warn",
  "batch-running": "info",
};

export type GitOf = (slot: Slot) => GitState | null;

export function isOpen(slot: Slot): boolean {
  const state = slot.editor?.state ?? "closed";
  return state !== "closed" && state !== "missing";
}

/** Dashboard time plus the time since it arrived: durations stay right between refreshes. */
export function nowFor(doc: Dashboard | null, receivedAt: number): Date {
  const base = doc?.time ? Date.parse(doc.time) : NaN;
  return new Date(Number.isNaN(base) ? Date.now() : base + (Date.now() - receivedAt));
}

export function elapsedSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : now.getTime() - at;
}

export function localOnlyDays(git: GitState | null | undefined, now: Date): number | null {
  const commits = git?.localOnly?.commits ?? 0;
  const since = elapsedSince(git?.localOnly?.oldestAt, now);
  if (!commits || since === null) return null;
  return Math.floor(since / DAY);
}

/** Basic refreshes carry only status fields; keep the last full answer for the rest. */
export function mergeGit(basic: GitState | null | undefined, full: GitState | undefined): GitState | null {
  if (!basic && !full) return null;
  if (!full || basic?.level === "full") return basic ?? null;
  if (!basic) return full;
  const merged: GitState = { ...full };
  for (const key of ["branch", "upstream", "upstreamGone", "changes", "ahead", "behind", "lastFetchAt", "error"] as const) {
    if (basic[key] !== undefined) (merged as Record<string, unknown>)[key] = basic[key];
  }
  merged.level = "full";
  return merged;
}

// ---------------------------------------------------------------- projects and repositories

/** The list group (project) a slot belongs to: the repository name the core reports. */
export function groupName(slot: Slot): string {
  return slot.repo || slot.project || "-";
}

/** Slots by group, in the core's order of first appearance. */
export function projectGroups(slots: readonly Slot[]): Map<string, Slot[]> {
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = groupName(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return groups;
}

/** Lowercase, forward slashes, no trailing slash: one git directory compares equal however it is written. */
export function repoKey(commonDir: string): string {
  return commonDir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function slotRepoKey(slot: Slot, gitOf: GitOf): string | null {
  const dir = gitOf(slot)?.commonDir;
  return dir ? repoKey(dir) : null;
}

/**
 * Git directories that two or more slots share (worktree slots of one repository), with their
 * slots. A clone has its own git directory and is not here. Works with every core that reports
 * `git.commonDir` (0.4 and later); the core counts the shared numbers once and copies them to each.
 */
export function sharedRepos(slots: readonly Slot[], gitOf: GitOf): Map<string, Slot[]> {
  const byRepo = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = slotRepoKey(s, gitOf);
    if (!key) continue;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(s);
  }
  for (const [key, members] of byRepo) if (members.length < 2) byRepo.delete(key);
  return byRepo;
}

/** The numbers a repository has once whatever folder looks at it (full git only). */
export interface RepoCounts {
  localOnly: number;
  localOnlyOldestAt: string | null;
  noUpstream: number;
  gone: number;
  stash: number;
  /** Local branches; null when the core did not count them. */
  total: number | null;
}

export function repoCounts(git: GitState | null | undefined): RepoCounts | null {
  if (!git || git.level !== "full") return null;
  return {
    localOnly: git.localOnly?.commits ?? 0,
    localOnlyOldestAt: git.localOnly?.oldestAt ?? null,
    noUpstream: git.branches?.noUpstream ?? 0,
    gone: git.branches?.upstreamGone ?? 0,
    stash: git.stash ?? 0,
    total: git.branches?.total ?? null,
  };
}

/** Oldest and newest last fetch among the slots (clones fetch on their own). */
export function fetchRange(slots: readonly Slot[], gitOf: GitOf): { oldest: string; newest: string } | null {
  const times = slots
    .map((s) => gitOf(s)?.lastFetchAt)
    .filter((v): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return times.length ? { oldest: times[0], newest: times[times.length - 1] } : null;
}

/** How a project's folders are laid out: clones (own git directory) and worktree slots (shared). */
export function layoutCounts(slots: readonly Slot[], gitOf: GitOf): { clones: number; worktrees: number } {
  const shared = sharedRepos(slots, gitOf);
  const inShared = new Set([...shared.values()].flat().map((s) => s.name));
  const worktrees = slots.filter((s) => inShared.has(s.name) || s.kind === "worktree").length;
  return { clones: slots.length - worktrees, worktrees };
}

// ---------------------------------------------------------------- warnings

export function warnings(doc: Dashboard, settings: WidgetSettings, now: Date, gitOf: GitOf): Warning[] {
  const list: Warning[] = [];
  const percent = doc.system?.commit?.percent;
  if (typeof percent === "number") {
    if (percent >= settings.commitCriticalPercent) list.push({ severity: "critical", text: t("sys.commit-critical", { percent }) });
    else if (percent >= settings.commitWarnPercent) list.push({ severity: "warn", text: t("sys.commit-high", { percent }) });
  }
  for (const flag of doc.systemFlags ?? []) {
    if (WIDGET_OWNED_FLAGS.has(flag)) continue;
    if (flag === "editors-at-max") {
      list.push({
        severity: "warn",
        text: t("sys.editors-at-max", { open: doc.system?.editorsOpen ?? "?", max: doc.registry?.maxEditors ?? "?" }),
      });
    } else {
      list.push({ severity: "info", text: t("sys.other", { flag }) });
    }
  }

  const slots = doc.slots ?? [];
  const shared = sharedRepos(slots, gitOf);
  const counted = new Set<string>();
  for (const slot of slots) {
    const editor = slot.editor;
    const gb = editor?.memory?.totalPrivGB;
    for (const flag of slot.flags ?? []) {
      if (WIDGET_OWNED_FLAGS.has(flag)) continue;
      const severity = FLAG_SEVERITY[flag] ?? "info";
      const key = `flag.${flag}`;
      const params = {
        slot: slot.name,
        gb: typeof gb === "number" ? gb.toFixed(1) : "?",
        time: formatWhen(slot.lease?.expiresAt, now),
        duration: formatDuration(elapsedSince(editor?.startedAt, now) ?? 0),
        flag,
      };
      const text = t(key, params);
      list.push({ severity, slot: slot.name, text: text === key ? t("flag.other", params) : text });
    }
    if (typeof gb === "number" && gb >= settings.slotMemoryWarnGb && !(slot.flags ?? []).includes("open-without-lease")) {
      list.push({ severity: "warn", slot: slot.name, text: t("flag.memory-high", { slot: slot.name, gb: gb.toFixed(1) }) });
    }
    // Commits on no remote belong to the repository: once for slots that share one
    const repo = slotRepoKey(slot, gitOf);
    const members = repo ? shared.get(repo) : undefined;
    if (repo && members) {
      if (counted.has(repo)) continue;
      counted.add(repo);
    }
    const git = gitOf(slot);
    const days = localOnlyDays(git, now);
    if (days !== null && days >= settings.localOnlyWarnDays) {
      const names = members ? members.map((s) => s.name) : [slot.name];
      list.push({
        severity: days >= settings.localOnlyCriticalDays ? "critical" : "warn",
        slot: names[0],
        ...(names.length > 1 ? { slots: names } : {}),
        text: t("flag.local-only-old", { slot: names.join(", "), n: git?.localOnly?.commits ?? 0, days }),
      });
    }
  }
  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return list.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Slot names with a critical or attention warning (the 「주의」 filter, project marks). */
export function warnedSlots(list: readonly Warning[] | null): Set<string> {
  const names = new Set<string>();
  for (const w of list ?? []) {
    if (w.severity === "info") continue;
    for (const name of w.slots ?? (w.slot ? [w.slot] : [])) names.add(name);
  }
  return names;
}

// ---------------------------------------------------------------- what needs a person now

/** Stalled starts, the longest stalled first. */
export function stalledSlots(doc: Dashboard | null): Slot[] {
  const at = (s: Slot) => {
    const ms = Date.parse(s.editor?.startedAt ?? "");
    return Number.isNaN(ms) ? Infinity : ms;
  };
  return (doc?.slots ?? []).filter((s) => s.editor?.state === "stalled").sort((a, b) => at(a) - at(b));
}

/** The commit charge in percent when it is at or over the critical setting, else null. */
export function commitCritical(doc: Dashboard | null, settings: Pick<WidgetSettings, "commitCriticalPercent">): number | null {
  const percent = doc?.system?.commit?.percent;
  return typeof percent === "number" && percent >= settings.commitCriticalPercent ? percent : null;
}

/**
 * What the banner may show, most urgent first; the banner shows the first and counts the rest.
 * 1. The core failed while an older document is on screen (everything below may be out of date).
 * 2. A stalled start: a person has to look at the editor's dialog (the core never clicks one).
 * 3. The commit charge is critical: opening another editor may run out of memory.
 * Without a document a core error is the details column's empty state, not a banner.
 */
export type Urgent = { kind: "error"; code: string } | { kind: "stalled"; slot: Slot } | { kind: "commit"; percent: number };

export function urgentItems(doc: Dashboard | null, settings: Pick<WidgetSettings, "commitCriticalPercent">, error: string | null): Urgent[] {
  if (!doc) return [];
  const list: Urgent[] = [];
  if (error) list.push({ kind: "error", code: error });
  for (const slot of stalledSlots(doc)) list.push({ kind: "stalled", slot });
  const percent = commitCritical(doc, settings);
  if (percent !== null) list.push({ kind: "commit", percent });
  return list;
}

// ---------------------------------------------------------------- cleanup request

function localOnlyText(git: GitState | null, now: Date): string | null {
  const n = git?.localOnly?.commits ?? 0;
  if (n <= 0) return null;
  return git?.localOnly?.oldestAt ? t("git.localOnlySince", { n, date: formatWhen(git.localOnly.oldestAt, now) }) : t("git.localOnly", { n });
}

/** The repository's own numbers: commits on no remote, branches without or with a gone upstream, stashes. */
function repoParts(git: GitState | null, now: Date): string[] {
  const parts: string[] = [];
  const local = localOnlyText(git, now);
  if (local) parts.push(local);
  if ((git?.branches?.noUpstream ?? 0) > 0) parts.push(t("git.noUpstream", { n: git?.branches?.noUpstream ?? 0 }));
  if ((git?.branches?.upstreamGone ?? 0) > 0) parts.push(t("git.gone", { n: git?.branches?.upstreamGone ?? 0 }));
  if ((git?.stash ?? 0) > 0) parts.push(t("git.stash", { n: git?.stash ?? 0 }));
  return parts;
}

/** The folder's own: unpushed commits of its branch, uncommitted changes, open-editor flags. */
function folderParts(slot: Slot, git: GitState | null): string[] {
  const parts: string[] = [];
  if ((git?.ahead ?? 0) > 0) parts.push(t("git.ahead", { n: git?.ahead ?? 0 }));
  if ((git?.changes ?? 0) > 0) parts.push(t("git.changes", { n: git?.changes ?? 0 }));
  for (const flag of slot.flags ?? []) {
    if (flag === "open-without-lease" || flag === "lease-expired-open" || flag === "unsaved-scene") {
      const gb = slot.editor?.memory?.totalPrivGB;
      parts.push(t(`flag.${flag}`, { slot: "", gb: typeof gb === "number" ? gb.toFixed(1) : "?" }).trim());
    }
  }
  return parts;
}

export interface CleanupScope {
  /** Only these slots (a project, one slot); all slots when left out. */
  slots?: ReadonlySet<string> | null;
  /** Named in the title: a project or a slot name. */
  label?: string | null;
}

/**
 * Markdown checklist an agent session can work through, asking before each change. A repository
 * that several slots share gets one line for its own numbers, then a line per folder.
 */
export function cleanupRequest(doc: Dashboard, now: Date, gitOf: GitOf, scope: CleanupScope = {}): string | null {
  const all = doc.slots ?? [];
  const slots = scope.slots ? all.filter((s) => scope.slots!.has(s.name)) : all;
  const shared = sharedRepos(all, gitOf);
  const lines: string[] = [];
  const repoDone = new Set<string>();
  for (const slot of slots) {
    const git = gitOf(slot);
    const repo = slotRepoKey(slot, gitOf);
    const members = repo ? shared.get(repo) : undefined;
    if (repo && members) {
      if (!repoDone.has(repo)) {
        repoDone.add(repo);
        const parts = repoParts(git, now);
        if (parts.length) {
          lines.push(
            `- [ ] ${t("cleanup.repoLine", { dir: git?.commonDir ?? repo, slots: members.map((s) => s.name).join(", ") })}: ${parts.join(" · ")}`,
          );
        }
      }
      const own = folderParts(slot, git);
      if (own.length) lines.push(`- [ ] ${slot.name} (${slot.path}): ${own.join(" · ")}`);
      continue;
    }
    const parts = [...repoParts(git, now), ...folderParts(slot, git)];
    if (parts.length) lines.push(`- [ ] ${slot.name} (${slot.path}): ${parts.join(" · ")}`);
  }
  if (!lines.length) return null;
  const time = formatWhen(doc.time, now);
  const title = scope.label ? t("cleanup.titleScoped", { scope: scope.label, time }) : t("cleanup.title", { time });
  const notes = [t("cleanup.fetchNote")];
  if (repoDone.size) notes.push(t("cleanup.worktreeNote"));
  notes.push(t("cleanup.request"));
  return [title, "", ...lines, "", ...notes, ""].join("\n");
}
