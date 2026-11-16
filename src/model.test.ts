import { beforeAll, describe, expect, it } from "vitest";
import { formatWhen, setLang, t } from "./i18n";
import {
  cleanupRequest,
  fetchRange,
  fullRepos,
  layoutCounts,
  mergeGit,
  mergeRepos,
  repoKey,
  sharedRepos,
  urgentItems,
  warnedSlots,
  warnings,
} from "./model";
import { defaultSettings } from "./settings";
import type { Dashboard, GitState, RepoGit, Slot } from "./types";

const NOW = new Date("2026-11-16T12:00:00+09:00");
const settings = defaultSettings();

function git(commonDir: string, extra: Partial<GitState> = {}): GitState {
  return {
    level: "full",
    branch: "master",
    changes: 0,
    ahead: 0,
    behind: 0,
    commonDir,
    localOnly: { commits: 0, oldestAt: null },
    branches: { total: 1, noUpstream: 0, upstreamGone: 0 },
    stash: 0,
    ...extra,
  };
}

function slot(name: string, g: GitState | null, extra: Partial<Slot> = {}): Slot {
  return { name, path: `C:\\repo\\${name}`, repo: "MyGame", editor: { state: "closed" }, git: g, ...extra };
}

// MyGame and MyGame-wt share one git directory; MyGame-1 is a clone
const OLD = { commits: 7, oldestAt: "2026-10-01T09:00:00+09:00" };
const shared = (name: string, extra: Partial<GitState> = {}) =>
  slot(name, git("C:\\repo\\MyGame\\.git", { localOnly: OLD, branches: { total: 9, noUpstream: 3, upstreamGone: 1 }, stash: 2, ...extra }));
const docOf = (slots: Slot[], extra: Partial<Dashboard> = {}): Dashboard => ({
  schema: "unity-slot.dashboard/1",
  time: NOW.toISOString(),
  system: { commit: { percent: 60 } },
  slots,
  ...extra,
});
const gitOf = (s: Slot) => s.git ?? null;

describe("repositories several slots share", () => {
  beforeAll(() => setLang("en"));

  it("compare git directories however they are written", () => {
    expect(repoKey("C:\\Repo\\MyGame\\.git\\")).toBe(repoKey("c:/repo/mygame/.git"));
  });

  it("finds a git directory used by two slots and leaves clones out", () => {
    const slots = [shared("MyGame"), shared("MyGame-wt", { branch: "build/webgl" }), slot("MyGame-1", git("C:/repo/MyGame-1/.git"))];
    const map = sharedRepos(slots, gitOf);
    expect([...map.keys()]).toEqual([repoKey("C:\\repo\\MyGame\\.git")]);
    expect(map.get(repoKey("C:\\repo\\MyGame\\.git"))!.map((s) => s.name)).toEqual(["MyGame", "MyGame-wt"]);
    expect(layoutCounts(slots, gitOf)).toEqual({ clones: 1, worktrees: 2 });
  });

  it("warns once per repository about old commits on no remote", () => {
    const slots = [shared("MyGame"), shared("MyGame-wt"), slot("MyGame-1", git("C:/repo/MyGame-1/.git", { localOnly: OLD }))];
    const list = warnings(docOf(slots), settings, NOW, gitOf).filter((w) => w.text.includes("on no remote"));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ slot: "MyGame", slots: ["MyGame", "MyGame-wt"], severity: "critical" });
    expect(list[0].text).toContain("MyGame, MyGame-wt");
    expect(list[1]).toMatchObject({ slot: "MyGame-1" });
    expect(list[1].slots).toBeUndefined();
    expect([...warnedSlots(list)].sort()).toEqual(["MyGame", "MyGame-1", "MyGame-wt"]);
  });

  it("puts the repository's numbers on one line of the cleanup request", () => {
    const slots = [shared("MyGame", { changes: 2 }), shared("MyGame-wt", { ahead: 1 })];
    const text = cleanupRequest(docOf(slots), NOW, gitOf)!;
    const lines = text.split("\n").filter((l) => l.startsWith("- [ ]"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("C:\\repo\\MyGame\\.git");
    expect(lines[0]).toContain(t("git.stash", { n: 2 }));
    expect(lines[1]).toBe(`- [ ] MyGame (C:\\repo\\MyGame): ${t("git.changes", { n: 2 })}`);
    expect(lines[2]).toBe(`- [ ] MyGame-wt (C:\\repo\\MyGame-wt): ${t("git.ahead", { n: 1 })}`);
    expect(text).toContain(t("cleanup.worktreeNote"));
  });

  it("limits the cleanup request to a scope and names it", () => {
    const slots = [slot("A", git("C:/a/.git", { changes: 1 })), slot("B", git("C:/b/.git", { changes: 3 }))];
    const text = cleanupRequest(docOf(slots), NOW, gitOf, { slots: new Set(["B"]), label: "B" })!;
    expect(text.split("\n")[0]).toBe(t("cleanup.titleScoped", { scope: "B", time: "12:00" }));
    expect(text).toContain("- [ ] B (");
    expect(text).not.toContain("- [ ] A (");
    expect(text).not.toContain(t("cleanup.worktreeNote"));
    expect(cleanupRequest(docOf(slots), NOW, gitOf, { slots: new Set(["C"]) })).toBeNull();
  });

  it("gives the oldest and newest fetch", () => {
    const slots = [
      slot("A", git("C:/a/.git", { lastFetchAt: "2026-11-15T10:00:00+09:00" })),
      slot("B", git("C:/b/.git", { lastFetchAt: "2026-11-05T10:00:00+09:00" })),
      slot("C", git("C:/c/.git", { lastFetchAt: null })),
    ];
    expect(fetchRange(slots, gitOf)).toEqual({ oldest: "2026-11-05T10:00:00+09:00", newest: "2026-11-15T10:00:00+09:00" });
    expect(fetchRange([], gitOf)).toBeNull();
  });
});

describe("what the banner shows", () => {
  const stalled = (name: string, startedAt: string) => slot(name, null, { editor: { state: "stalled", startedAt } });

  it("has nothing without a document (the details column shows the error)", () => {
    expect(urgentItems(null, settings, "timeout")).toEqual([]);
  });

  it("orders a core error, stalled starts (longest first), then a critical commit charge", () => {
    const doc = docOf([stalled("B", "2026-11-16T11:58:00+09:00"), stalled("A", "2026-11-16T11:50:00+09:00")], {
      system: { commit: { percent: 93 } },
    });
    const items = urgentItems(doc, settings, "timeout");
    expect(items.map((i) => (i.kind === "stalled" ? `stalled:${i.slot.name}` : i.kind))).toEqual(["error", "stalled:A", "stalled:B", "commit"]);
    expect(urgentItems(docOf([]), settings, null)).toEqual([]);
  });
});

describe("git directories (core 0.7.0 repos)", () => {
  beforeAll(() => setLang("en"));

  const A = "C:/repo/MyGame/.git";
  const B = "C:/repo/MyGame-1/.git";
  const fullRepo = (commonDir: string, slotName: string, extra: Partial<RepoGit> = {}): RepoGit => ({
    commonDir,
    repo: "MyGame",
    level: "full",
    folders: [{ path: `C:/repo/${slotName}`, slot: slotName, main: true, branch: "master", head: "aaa", detached: false }],
    branches: [{ name: "master", tip: "aaa", upstream: "origin/master", upstreamGone: false, ahead: 0, behind: 0, localOnly: { commits: 0, oldestAt: null } }],
    stashes: [],
    ...extra,
  });

  it("keeps basic folder fields over the last full git (head, detached, change kinds, git directory)", () => {
    const full = git(A, { head: "old", detached: false, changesDetail: { staged: 1 }, gitDir: "x" });
    const basic: GitState = { level: "basic", branch: "(detached)", head: "new", detached: true, changesDetail: { untracked: 2 }, gitDir: A, changes: 2 };
    const merged = mergeGit(basic, full)!;
    expect(merged).toMatchObject({ level: "full", branch: "(detached)", head: "new", detached: true, changesDetail: { untracked: 2 }, gitDir: A });
    expect(merged.localOnly).toEqual(full.localOnly);
  });

  it("merges repos: the last full branches with the folders of a basic refresh", () => {
    const last = fullRepo(A, "MyGame");
    const basic: RepoGit = {
      commonDir: "c:/repo/mygame/.git",
      level: "basic",
      folders: [{ path: "C:/repo/MyGame", slot: "MyGame", branch: "feature/new", head: "bbb" }],
      branches: null,
      stashes: null,
    };
    const merged = mergeRepos([basic, fullRepo(B, "MyGame-1", { level: "basic", branches: null })], fullRepos({ schema: "x", repos: [last] }))!;
    expect(merged[0].branches).toEqual(last.branches);
    expect(merged[0].folders![0].branch).toBe("feature/new");
    expect(merged[1].branches).toBeNull();
    expect(mergeRepos(undefined, new Map())).toBeNull();
  });

  it("takes the fields a basic refresh has from it, and keeps a detached folder's own commits while it stays put", () => {
    const lo = { commits: 2, oldestAt: "2026-11-15T09:00:00+09:00" };
    const last = fullRepo(A, "MyGame", {
      lastFetchAt: "2026-11-10T09:00:00+09:00",
      folders: [{ path: "C:/repo/MyGame", slot: "MyGame", main: true, branch: null, head: "d1", detached: true, localOnly: lo }],
      localOnly: lo,
      flags: ["detached-local-only"],
    });
    const basicOf = (head: string): RepoGit => ({
      commonDir: A,
      level: "basic",
      lastFetchAt: "2026-11-16T11:00:00+09:00",
      folders: [{ path: "C:\\repo\\MyGame", slot: "MyGame", main: true, branch: null, head, detached: true, localOnly: null }],
      branches: null,
      stashes: null,
      localOnly: null,
      flags: null,
      error: null,
    });
    const [same] = mergeRepos([basicOf("d1")], fullRepos({ schema: "x", repos: [last] }))!;
    expect(same).toMatchObject({ level: "full", lastFetchAt: "2026-11-16T11:00:00+09:00", localOnly: lo, flags: ["detached-local-only"] });
    expect(same.branches).toEqual(last.branches);
    expect(same.folders![0].localOnly).toEqual(lo);
    // Moved to another commit: the old count no longer applies
    const [moved] = mergeRepos([basicOf("d2")], fullRepos({ schema: "x", repos: [last] }))!;
    expect(moved.folders![0].localOnly).toBeNull();
  });

  it("warns per branch, once per tip, instead of once per repository", () => {
    const lo = { commits: 7, oldestAt: "2026-10-01T09:00:00+09:00" };
    const slots = [slot("MyGame", git(A, { localOnly: OLD })), slot("MyGame-1", git(B, { localOnly: OLD }))];
    const repos = [
      fullRepo(A, "MyGame", {
        branches: [
          { name: "backup/x", tip: "c9", upstream: null, localOnly: lo },
          { name: "feature/new", tip: "d1", upstream: null, localOnly: { commits: 1, oldestAt: "2026-11-16T09:00:00+09:00" } },
        ],
      }),
      fullRepo(B, "MyGame-1", { branches: [{ name: "backup/x", tip: "c9", upstream: null, localOnly: lo }] }),
    ];
    const list = warnings(docOf(slots), settings, NOW, gitOf, repos).filter((w) => w.text.includes("on no remote"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ severity: "critical", slot: "MyGame", slots: ["MyGame", "MyGame-1"] });
    expect(list[0].text).toContain("backup/x");
    // Without branches for a git directory, its own count still warns
    const half = warnings(docOf(slots), settings, NOW, gitOf, [repos[0], { ...repos[1], branches: null }]).filter((w) => w.text.includes("on no remote"));
    expect(half.map((w) => w.slot)).toEqual(["MyGame-1", "MyGame"]);
  });

  it("names the branches behind a repository's numbers in the cleanup request", () => {
    const slots = [slot("MyGame", git(A, { localOnly: OLD }))];
    const repos = [
      fullRepo(A, "MyGame", {
        branches: [
          { name: "master", tip: "aaa", upstream: "origin/master", ahead: 2, localOnly: { commits: 0 } },
          { name: "feature/old", tip: "bbb", upstream: "origin/feature/old", upstreamGone: true, localOnly: OLD },
          { name: "feature/clean", tip: "ccc", upstream: "origin/feature/clean", ahead: 0, localOnly: { commits: 0 } },
        ],
      }),
    ];
    const text = cleanupRequest(docOf(slots), NOW, gitOf, {}, repos)!;
    expect(text).toContain(`  - master: ${t("git.ahead", { n: 2 })}`);
    expect(text).toContain(`  - feature/old: ${t("git.localOnlySince", { n: 7, date: formatWhen(OLD.oldestAt, NOW) })} · ${t("cleanup.branchGone")}`);
    expect(text).not.toContain("feature/clean");
    expect(text).toContain(t("cleanup.branchNote"));
  });
});
