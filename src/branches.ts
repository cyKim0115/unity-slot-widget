/**
 * The branch screen's judgement (core 0.7.0 `repos[]`), pure: every local branch of a project by
 * name, whichever slots have a copy, how worried to be about it, and what is in progress (changes,
 * stashes). screens/branches.ts draws it.
 *
 * Clones keep separate object stores, so the core cannot tell whether one clone's tip contains
 * another's; the app compares same-name copies itself, and says 「받기만 하면 됨」 only when that
 * is safe (critique data-safety 1): every copy tracks an upstream of the same name that still
 * exists, is not ahead of it and has no commit on no remote. A copy ahead of its upstream makes the
 * group 「앞선 사본 있음」; copies without an upstream or with another one cannot be compared.
 *
 * Who has which branch checked out comes from `folders[]`, which a basic refresh brings too, so it
 * is current between full answers; a checked-out branch the last full answer does not have yet is a
 * 「새 브랜치(자세한 git 전)」.
 */
import type { Branch, BranchView, ChangesDetail, Dashboard, RepoFolder, RepoGit, Slot, Stash, WidgetSettings } from "./types";
import { formatWhen, t } from "./i18n";
import { daysSince, detachedName, type GitOf, projectGroups, repoGroupName, repoKey, repoSlots } from "./model";

/** How the copies of a same-name branch compare. */
export type Verdict = "single" | "same" | "behind-only" | "ahead-copy" | "diverged" | "unknown";
export type Level = "critical" | "warn" | "info" | "clean";

/** Why a branch is on the list, most serious first. */
export const REASONS = [
  "localOnlyCritical",
  "goneLocalOnly",
  "localOnlyWarn",
  "diverged",
  "aheadCopy",
  "ahead",
  "upstreamName",
  "localOnlyRecent",
  "detached",
  "noUpstream",
  "gone",
  "mergedIdle",
  "behindOnly",
  "unknown",
  "pending",
] as const;
export type Reason = (typeof REASONS)[number];

const REASON_LEVEL: Record<Reason, Exclude<Level, "clean">> = {
  localOnlyCritical: "critical",
  goneLocalOnly: "critical",
  localOnlyWarn: "warn",
  diverged: "warn",
  aheadCopy: "warn",
  ahead: "warn",
  upstreamName: "warn",
  localOnlyRecent: "info",
  detached: "info",
  noUpstream: "info",
  gone: "info",
  mergedIdle: "info",
  behindOnly: "info",
  unknown: "info",
  pending: "info",
};

export const LEVEL_RANK: Record<Level, number> = { critical: 0, warn: 1, info: 2, clean: 3 };

export interface Checkout {
  slot: string | null;
  path: string;
}

/** One git directory's copy of a branch. */
export interface BranchCopy {
  repoKey: string;
  commonDir: string;
  /** The slots that see this copy: the clone, or every slot of a git directory they share. */
  holders: string[];
  name: string;
  tip: string | null;
  tipAt: string | null;
  subject: string | null;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number | null;
  behind: number | null;
  merged: boolean | null;
  /** Commits on no remote reachable from it; null when unknown. */
  localOnly: number | null;
  localOnlyAt: string | null;
  /** Folders that have it checked out now (basic `folders[]`). */
  checkouts: Checkout[];
  /** Checked out, but the last full answer does not have it (or there is none yet). */
  pending: boolean;
  /** A detached working folder, listed like a branch. */
  detached: boolean;
  /** The git directory's last fetch: ahead and behind are as of then. */
  lastFetchAt: string | null;
  reasons: Reason[];
  level: Level;
}

/** A branch name in a project, with every copy. */
export interface BranchGroup {
  project: string;
  name: string;
  copies: BranchCopy[];
  /** How many different tips the copies have. */
  tips: number;
  verdict: Verdict;
  reasons: Reason[];
  level: Level;
  /** The most commits on no remote among the copies, and the oldest one's time. */
  localOnly: number;
  localOnlyAt: string | null;
  checkedOut: boolean;
  detached: boolean;
}

export interface RepoEntry {
  key: string;
  repo: RepoGit;
  slots: Slot[];
  /** The last full answer listed its branches. */
  hasBranches: boolean;
}

export interface ChangeItem {
  slot: Slot;
  branch: string | null;
  changes: number;
  detail: ChangesDetail | null;
}

export interface StashItem {
  repoKey: string;
  holders: string[];
  stash: Stash;
}

export interface ProjectBranches {
  project: string;
  slots: Slot[];
  repos: RepoEntry[];
  /** Most serious first. */
  groups: BranchGroup[];
  changes: ChangeItem[];
  stashes: StashItem[];
  /** The view repository `branch-view` made for the project, if any. */
  view: BranchView | null;
  /** A git directory of the project has no detailed git answer yet. */
  pendingFull: boolean;
}

type Thresholds = Pick<WidgetSettings, "localOnlyWarnDays" | "localOnlyCriticalDays">;

/** The branch name of an upstream: `origin/feature/x` → `feature/x`. */
export function upstreamBranch(upstream: string): string {
  const i = upstream.indexOf("/");
  return i < 0 ? upstream : upstream.slice(i + 1);
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "-";
}

function levelOf(reasons: readonly Reason[]): Level {
  let level: Level = "clean";
  for (const r of reasons) if (LEVEL_RANK[REASON_LEVEL[r]] < LEVEL_RANK[level]) level = REASON_LEVEL[r];
  return level;
}

function sortReasons(reasons: Iterable<Reason>): Reason[] {
  return [...new Set(reasons)].sort((a, b) => REASONS.indexOf(a) - REASONS.indexOf(b));
}

/** A copy's own reasons: its commits on no remote, its upstream, whether it looks finished. */
export function copyReasons(c: Omit<BranchCopy, "reasons" | "level">, settings: Thresholds, now: Date, defaultName: string | null): Reason[] {
  if (c.pending) return ["pending"];
  const reasons: Reason[] = [];
  const n = c.localOnly ?? 0;
  if (n > 0) {
    const days = daysSince(c.localOnlyAt, now);
    if (days !== null && days >= settings.localOnlyCriticalDays) reasons.push("localOnlyCritical");
    else if (c.upstreamGone) reasons.push("goneLocalOnly");
    else if (days !== null && days >= settings.localOnlyWarnDays) reasons.push("localOnlyWarn");
    else reasons.push("localOnlyRecent");
  }
  if (c.detached) {
    reasons.push("detached");
    return reasons;
  }
  if (c.upstream && !c.upstreamGone && (c.ahead ?? 0) > 0) reasons.push("ahead");
  if (c.upstream && upstreamBranch(c.upstream) !== c.name) reasons.push("upstreamName");
  if (!c.upstream) reasons.push("noUpstream");
  if (c.upstream && c.upstreamGone && n === 0) reasons.push("gone");
  if (c.merged === true && c.checkouts.length === 0 && c.name !== defaultName) reasons.push("mergedIdle");
  return reasons;
}

/**
 * Same-name copies (critique data-safety 1): 「받기만 하면 됨」 needs every copy on an upstream of
 * its own name that still exists, none ahead of it and none with commits on no remote.
 */
export function verdictOf(copies: readonly Pick<BranchCopy, "name" | "tip" | "upstream" | "upstreamGone" | "ahead" | "localOnly" | "pending">[]): Verdict {
  if (copies.length < 2) return "single";
  if (copies.every((c) => c.tip) && new Set(copies.map((c) => c.tip)).size === 1) return "same";
  const pullOnly = copies.every(
    (c) => !c.pending && !!c.upstream && upstreamBranch(c.upstream) === c.name && c.upstreamGone !== true && c.ahead === 0 && c.localOnly === 0,
  );
  if (pullOnly) return "behind-only";
  if (copies.some((c) => (c.localOnly ?? 0) > 0)) return "diverged";
  if (copies.some((c) => (c.ahead ?? 0) > 0)) return "ahead-copy";
  return "unknown";
}

const VERDICT_REASON: Partial<Record<Verdict, Reason>> = {
  diverged: "diverged",
  "ahead-copy": "aheadCopy",
  "behind-only": "behindOnly",
  unknown: "unknown",
};

/** The default branch's local name (`origin/master` → `master`). */
function defaultName(repo: RepoGit): string | null {
  return repo.defaultBranch ? upstreamBranch(repo.defaultBranch) : null;
}

function makeCopy(base: Omit<BranchCopy, "reasons" | "level">, settings: Thresholds, now: Date, dflt: string | null): BranchCopy {
  const reasons = copyReasons(base, settings, now, dflt);
  return { ...base, reasons, level: levelOf(reasons) };
}

/** Every copy one git directory has: its branches, checked-out ones it does not list yet, detached folders. */
export function repoCopies(repo: RepoGit, holders: string[], settings: Thresholds, now: Date): BranchCopy[] {
  const key = repoKey(repo.commonDir);
  const dflt = defaultName(repo);
  const checkouts = new Map<string, Checkout[]>();
  for (const f of repo.folders ?? []) {
    if (f.detached || !f.branch) continue;
    if (!checkouts.has(f.branch)) checkouts.set(f.branch, []);
    checkouts.get(f.branch)!.push({ slot: f.slot ?? null, path: f.path });
  }
  const common = { repoKey: key, commonDir: repo.commonDir, holders, lastFetchAt: repo.lastFetchAt ?? null };
  const copies: BranchCopy[] = [];
  const listed = new Set<string>();
  for (const b of Array.isArray(repo.branches) ? repo.branches : []) {
    listed.add(b.name);
    copies.push(makeCopy({ ...common, ...fromBranch(b), checkouts: checkouts.get(b.name) ?? [], pending: false, detached: false }, settings, now, dflt));
  }
  for (const [name, list] of checkouts) {
    if (listed.has(name)) continue;
    const head = (repo.folders ?? []).find((f) => f.branch === name)?.head ?? null;
    copies.push(makeCopy({ ...common, ...emptyBranch(name, head), checkouts: list, pending: true, detached: false }, settings, now, dflt));
  }
  for (const f of repo.folders ?? []) {
    if (!f.detached) continue;
    copies.push(makeCopy({ ...common, ...detachedBranch(f), checkouts: [{ slot: f.slot ?? null, path: f.path }], pending: false, detached: true }, settings, now, dflt));
  }
  return copies;
}

type BranchFields = Pick<BranchCopy, "name" | "tip" | "tipAt" | "subject" | "upstream" | "upstreamGone" | "ahead" | "behind" | "merged" | "localOnly" | "localOnlyAt">;

function fromBranch(b: Branch): BranchFields {
  return {
    name: b.name,
    tip: b.tip ?? null,
    tipAt: b.tipAt ?? null,
    subject: b.subject ?? null,
    upstream: b.upstream ?? null,
    upstreamGone: b.upstreamGone === true,
    ahead: b.ahead ?? null,
    behind: b.behind ?? null,
    merged: b.merged ?? null,
    localOnly: b.localOnly ? (b.localOnly.commits ?? null) : null,
    localOnlyAt: b.localOnly?.oldestAt ?? null,
  };
}

function emptyBranch(name: string, tip: string | null): BranchFields {
  return { name, tip, tipAt: null, subject: null, upstream: null, upstreamGone: false, ahead: null, behind: null, merged: null, localOnly: null, localOnlyAt: null };
}

function detachedBranch(f: RepoFolder): BranchFields {
  return {
    ...emptyBranch(detachedName(f), f.head ?? null),
    localOnly: f.localOnly ? (f.localOnly.commits ?? null) : null,
    localOnlyAt: f.localOnly?.oldestAt ?? null,
  };
}

/** The copies of one name as a group: how they compare, how serious, the worst commits on no remote. */
export function groupOf(project: string, name: string, copies: BranchCopy[]): BranchGroup {
  const verdict = verdictOf(copies);
  const extra = VERDICT_REASON[verdict];
  const reasons = sortReasons([...(extra ? [extra] : []), ...copies.flatMap((c) => c.reasons)]);
  let localOnly = 0;
  let localOnlyAt: string | null = null;
  for (const c of copies) {
    if ((c.localOnly ?? 0) <= 0) continue;
    localOnly = Math.max(localOnly, c.localOnly ?? 0);
    if (c.localOnlyAt && (!localOnlyAt || Date.parse(c.localOnlyAt) < Date.parse(localOnlyAt))) localOnlyAt = c.localOnlyAt;
  }
  return {
    project,
    name,
    copies,
    tips: new Set(copies.map((c, i) => c.tip ?? `?${i}`)).size,
    verdict,
    reasons,
    level: levelOf(reasons),
    localOnly,
    localOnlyAt,
    checkedOut: copies.some((c) => c.checkouts.length > 0),
    detached: copies.some((c) => c.detached),
  };
}

/** Most serious first; within a level the oldest commits on no remote first, then by name. */
export function compareGroups(a: BranchGroup, b: BranchGroup): number {
  const level = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
  if (level) return level;
  const at = (g: BranchGroup) => (g.localOnlyAt ? Date.parse(g.localOnlyAt) : Infinity);
  const age = at(a) - at(b);
  if (age && !Number.isNaN(age)) return age;
  return a.name.localeCompare(b.name);
}

/** The view repository of a project: by the registry project (lower case in the state file), else the repo name. */
export function viewFor(views: readonly BranchView[] | null | undefined, project: string, slots: readonly Slot[]): BranchView | null {
  const keys = new Set(slots.map((s) => (s.project ?? "").trim().toLowerCase()).filter(Boolean));
  return (
    (views ?? []).find((v) => v.project && keys.has(v.project.trim().toLowerCase())) ??
    (views ?? []).find((v) => !!v.repo && v.repo === project) ??
    null
  );
}

/** Every project with its git directories, branch groups, changes and stashes (projectGroups order). */
export function buildProjects(doc: Dashboard, repos: readonly RepoGit[] | null, gitOf: GitOf, settings: Thresholds, now: Date): ProjectBranches[] {
  const all = doc.slots ?? [];
  const entries = (repos ?? [])
    .filter((r) => !!r.commonDir)
    .map((repo): RepoEntry & { project: string } => {
      const slots = repoSlots(repo, all, gitOf);
      return { key: repoKey(repo.commonDir), repo, slots, hasBranches: Array.isArray(repo.branches), project: repoGroupName(repo, slots) };
    });
  const out: ProjectBranches[] = [];
  for (const [project, members] of projectGroups(all)) {
    const mine = entries.filter((e) => e.project === project);
    const byName = new Map<string, BranchCopy[]>();
    const stashes: StashItem[] = [];
    for (const e of mine) {
      const holders = e.slots.map((s) => s.name);
      for (const c of repoCopies(e.repo, holders, settings, now)) {
        if (!byName.has(c.name)) byName.set(c.name, []);
        byName.get(c.name)!.push(c);
      }
      for (const s of e.repo.stashes ?? []) stashes.push({ repoKey: e.key, holders, stash: s });
    }
    const groups = [...byName].map(([name, copies]) => groupOf(project, name, copies)).sort(compareGroups);
    const changes = members
      .map((slot) => ({ slot, git: gitOf(slot) }))
      .filter(({ git }) => (git?.changes ?? 0) > 0)
      .map(({ slot, git }) => ({ slot, branch: git?.branch ?? null, changes: git?.changes ?? 0, detail: git?.changesDetail ?? null }));
    out.push({
      project,
      slots: members,
      repos: mine.map(({ project: _p, ...e }) => e),
      groups,
      changes,
      stashes,
      view: viewFor(doc.branchViews, project, members),
      pendingFull: mine.some((e) => !e.hasBranches),
    });
  }
  return out;
}

// ---------------------------------------------------------------- filters and counts

export type BranchFilter = "attention" | "checkedout" | "all";
export const BRANCH_FILTERS: readonly BranchFilter[] = ["attention", "checkedout", "all"];

export function passesFilter(g: BranchGroup, filter: BranchFilter): boolean {
  if (filter === "attention") return g.level !== "clean";
  if (filter === "checkedout") return g.checkedOut;
  return true;
}

/** A copy of the group is in this slot's git directory, or the slot has it checked out. */
export function inSlot(g: BranchGroup, slot: string): boolean {
  return g.copies.some((c) => c.holders.includes(slot) || c.checkouts.some((k) => k.slot === slot));
}

/** The screen tab: every branch name, and how many need attention (critical and warn). */
export function branchCounts(projects: readonly ProjectBranches[]): { total: number; attention: number } {
  let total = 0;
  let attention = 0;
  for (const p of projects) {
    total += p.groups.length;
    attention += p.groups.filter((g) => g.level === "critical" || g.level === "warn").length;
  }
  return { total, attention };
}

/** 「바뀜 n」: slots whose refs changed since the view's last refresh (or that it does not have yet). */
export function viewChanged(view: BranchView | null): number {
  return (view?.slots ?? []).filter((s) => s.changedSince === true).length;
}

/** The view repository's ref for a copy: `<slot remote>/<branch>`. */
export function viewRef(view: BranchView | null, copy: BranchCopy): string | null {
  if (!view || copy.detached) return null;
  for (const holder of copy.holders) {
    const s = (view.slots ?? []).find((x) => x.slot === holder);
    if (s) return `${s.remote || s.slot}/${copy.name}`;
  }
  return null;
}

// ---------------------------------------------------------------- texts

/** The verdict as the screen says it, or null for a single copy. */
export function verdictText(g: BranchGroup): string | null {
  if (g.verdict === "single") return null;
  return t(`branch.verdict.${g.verdict}`, { n: g.copies.length, tips: g.tips });
}

export function reasonText(reason: Reason, g: BranchGroup): string {
  const upstreams = [...new Set(g.copies.map((c) => c.upstream).filter((u): u is string => !!u && upstreamBranch(u) !== g.name))];
  return t(`branch.reason.${reason}`, { n: g.localOnly, upstream: upstreams.join(", ") || "-" });
}

/** A checklist for one branch's copies, for an agent session (asking before each change). */
export function branchCleanupRequest(g: BranchGroup, slots: readonly Slot[], now: Date, time: string | null | undefined): string {
  const pathOf = (c: BranchCopy) => slots.find((s) => s.name === c.holders[0])?.path ?? c.commonDir;
  const lines = g.copies.map((c) => {
    const parts: string[] = [t("cleanup.branchTip", { sha: shortSha(c.tip) })];
    if (c.upstream) {
      parts.push(c.upstreamGone ? `${c.upstream} ${t("cleanup.branchGone")}` : `${c.upstream} ↑${c.ahead ?? "?"} ↓${c.behind ?? "?"}`);
    } else if (!c.detached) parts.push(t("branch.noUpstream"));
    if ((c.localOnly ?? 0) > 0) {
      parts.push(c.localOnlyAt ? t("git.localOnlySince", { n: c.localOnly ?? 0, date: formatWhen(c.localOnlyAt, now) }) : t("git.localOnly", { n: c.localOnly ?? 0 }));
    }
    const out = c.checkouts.map((k) => k.slot ?? k.path);
    if (out.length) parts.push(t("cleanup.checkedOutBy", { slots: out.join(", ") }));
    return `- [ ] ${c.holders.join(", ") || c.commonDir} (${pathOf(c)}): ${parts.join(" · ")}`;
  });
  const notes = [verdictText(g), t("cleanup.fetchNote"), t("cleanup.branchNote"), t("cleanup.request")].filter((x): x is string => !!x);
  return [t("cleanup.titleBranch", { branch: g.name, project: g.project, time: formatWhen(time, now) }), "", ...lines, "", ...notes, ""].join("\n");
}
