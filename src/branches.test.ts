import { beforeAll, describe, expect, it } from "vitest";
import { setLang, t } from "./i18n";
import {
  branchCleanupRequest,
  branchCounts,
  buildProjects,
  inSlot,
  passesFilter,
  repoCopies,
  verdictOf,
  viewChanged,
  viewRef,
  type BranchCopy,
} from "./branches";
import { fullRepos, mergeRepos } from "./model";
import { defaultSettings } from "./settings";
import type { Branch, Dashboard, GitState, RepoGit, Slot } from "./types";

const NOW = new Date("2026-11-16T12:00:00+09:00");
const settings = defaultSettings();
const OLD = "2026-10-01T09:00:00+09:00";
const RECENT = "2026-11-15T09:00:00+09:00";

/** A copy as verdictOf sees it. */
function copy(over: Partial<BranchCopy>): BranchCopy {
  return {
    repoKey: "k",
    commonDir: "C:/repo/x/.git",
    holders: ["x"],
    name: "master",
    tip: "aaa",
    tipAt: null,
    subject: null,
    upstream: "origin/master",
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    merged: null,
    localOnly: 0,
    localOnlyAt: null,
    checkouts: [],
    pending: false,
    detached: false,
    lastFetchAt: null,
    reasons: [],
    level: "clean",
    ...over,
  };
}

describe("same-name copies", () => {
  beforeAll(() => setLang("en"));

  it("a copy ahead of its upstream is not 「just pull」 even with nothing on no remote (critique data-safety 1)", () => {
    // Clone A fast-forwarded master to a pushed feature branch: no commit on no remote, but 2 ahead of origin/master
    const a = copy({ holders: ["A"], tip: "a2", ahead: 2, localOnly: 0 });
    const b = copy({ holders: ["B"], tip: "a0", ahead: 0, localOnly: 0 });
    expect(verdictOf([a, b])).toBe("ahead-copy");
  });

  it("is 「just pull」 only when every copy tracks its own name, exists upstream, is not ahead and has nothing on no remote", () => {
    const behind = copy({ tip: "x1", behind: 3 });
    const current = copy({ tip: "x2" });
    expect(verdictOf([behind, current])).toBe("behind-only");
    expect(verdictOf([behind, copy({ tip: "x2", upstream: null })])).toBe("unknown");
    expect(verdictOf([behind, copy({ tip: "x2", upstream: "origin/develop" })])).toBe("unknown");
    expect(verdictOf([behind, copy({ tip: "x2", upstreamGone: true })])).toBe("unknown");
    expect(verdictOf([behind, copy({ tip: "x2", localOnly: null })])).toBe("unknown");
    expect(verdictOf([behind, copy({ tip: "x2", ahead: null })])).toBe("unknown");
    expect(verdictOf([behind, copy({ tip: "x2", pending: true })])).toBe("unknown");
  });

  it("calls copies with their own commits diverged, same tips same, one copy single", () => {
    expect(verdictOf([copy({ tip: "x1" }), copy({ tip: "x2", localOnly: 3, ahead: 3 })])).toBe("diverged");
    expect(verdictOf([copy({ tip: "x1", upstream: null }), copy({ tip: "x1", upstream: null })])).toBe("same");
    expect(verdictOf([copy({})])).toBe("single");
    // An unknown tip is never the same as another
    expect(verdictOf([copy({ tip: null, upstream: null }), copy({ tip: null, upstream: null })])).toBe("unknown");
  });
});

// ---------------------------------------------------------------- a project of three clones

const branch = (name: string, over: Partial<Branch> = {}): Branch => ({
  name,
  tip: `${name}-tip`,
  tipAt: "2026-11-10T10:00:00+09:00",
  upstream: `origin/${name}`,
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  merged: false,
  localOnly: { commits: 0, oldestAt: null },
  checkedOutBy: [],
  ...over,
});

function slot(name: string, git: Partial<GitState> = {}): Slot {
  return {
    name,
    path: `C:/repo/${name}`,
    project: "me/mygame",
    repo: "MyGame",
    editor: { state: "closed" },
    git: { level: "basic", branch: "master", changes: 0, commonDir: `C:/repo/${name}/.git`, ...git },
  };
}

function repo(name: string, branches: Branch[] | null, folderBranch: string | null, over: Partial<RepoGit> = {}): RepoGit {
  return {
    commonDir: `C:/repo/${name}/.git`,
    project: "me/mygame",
    repo: "MyGame",
    level: branches ? "full" : "basic",
    layout: "clone",
    lastFetchAt: "2026-11-16T09:00:00+09:00",
    defaultBranch: "origin/master",
    folders: [{ path: `C:/repo/${name}`, slot: name, main: true, branch: folderBranch, head: `${folderBranch ?? "detached"}-head`, detached: folderBranch === null }],
    branches,
    stashes: branches ? [] : null,
    localOnly: null,
    flags: null,
    error: null,
    ...over,
  };
}

const slots = [
  slot("MyGame", { changes: 2, changesDetail: { staged: 1, unstaged: 1, untracked: 0, conflicted: 0 } }),
  slot("MyGame-1", { branch: "feature/rec" }),
  slot("MyGame-2", { branch: "(detached)", detached: true }),
  { ...slot("Other"), project: "me/other", repo: "Other" },
];

const full: RepoGit[] = [
  repo(
    "MyGame",
    [
      branch("master", { merged: true, baseAhead: 0 }),
      branch("feature/rec", { tip: "rec-1", behind: 3 }),
      branch("backup/old", { upstream: null, ahead: null, behind: null, localOnly: { commits: 9, oldestAt: OLD } }),
      branch("feature/done", { merged: true }),
      branch("feature/art", { upstream: "origin/master", tip: "art-1" }),
    ],
    "master",
    { stashes: [{ index: 0, sha: "s0", at: RECENT, branch: "master", message: "On master: wip" }] },
  ),
  repo("MyGame-1", [branch("master"), branch("feature/rec", { tip: "rec-2" })], "feature/rec"),
  repo(
    "MyGame-2",
    [branch("master", { tip: "m2", ahead: 2 }), branch("backup/old", { upstream: null, ahead: null, behind: null, localOnly: { commits: 9, oldestAt: OLD } })],
    null,
    { folders: [{ path: "C:/repo/MyGame-2", slot: "MyGame-2", main: true, branch: null, head: "d1", detached: true, localOnly: { commits: 1, oldestAt: RECENT } }] },
  ),
  repo("Other", [branch("master")], "master", { project: "me/other", repo: "Other" }),
];

const doc: Dashboard = {
  schema: "unity-slot.dashboard/1",
  version: "0.7.0",
  slots,
  repos: full,
  branchViews: [
    {
      project: "me/mygame",
      repo: "MyGame",
      path: "D:/view/MyGame.git",
      updatedAt: "2026-11-16T11:20:00+09:00",
      slots: [
        { slot: "MyGame", remote: "MyGame", status: "fetched", changedSince: false },
        { slot: "MyGame-1", remote: "MyGame-1", status: "fetched", changedSince: true },
        { slot: "MyGame-2", remote: "MyGame-2", status: "not-fetched", changedSince: true },
      ],
      origin: { filledFrom: "MyGame", rejected: [] },
    },
  ],
};
const gitOf = (s: Slot) => s.git ?? null;

describe("a project's branches", () => {
  beforeAll(() => setLang("en"));

  it("groups copies by name across clones, most serious first", () => {
    const [mygame, other] = buildProjects(doc, full, gitOf, settings, NOW);
    expect(mygame.project).toBe("MyGame");
    expect(other.project).toBe("Other");
    const names = mygame.groups.map((g) => g.name);
    expect(names[0]).toBe("backup/old");
    const old = mygame.groups[0];
    expect(old).toMatchObject({ level: "critical", verdict: "same", localOnly: 9, localOnlyAt: OLD });
    expect(old.copies.map((c) => c.holders[0])).toEqual(["MyGame", "MyGame-2"]);

    const master = mygame.groups.find((g) => g.name === "master")!;
    // MyGame-2's master is 2 ahead of origin/master: a copy is ahead, not 「just pull」
    expect(master).toMatchObject({ verdict: "ahead-copy", level: "warn" });
    expect(master.reasons[0]).toBe("aheadCopy");

    const rec = mygame.groups.find((g) => g.name === "feature/rec")!;
    expect(rec).toMatchObject({ verdict: "behind-only", level: "info", tips: 2, checkedOut: true });
    expect(rec.copies[1].checkouts).toEqual([{ slot: "MyGame-1", path: "C:/repo/MyGame-1" }]);

    expect(mygame.groups.find((g) => g.name === "feature/art")!.reasons).toContain("upstreamName");
    expect(mygame.groups.find((g) => g.name === "feature/done")!.reasons).toEqual(["mergedIdle"]);
    // The default branch is no cleanup candidate even when merged and not checked out
    expect(master.reasons).not.toContain("mergedIdle");

    const detached = mygame.groups.find((g) => g.detached)!;
    expect(detached.name).toBe(t("branch.detachedName", { slot: "MyGame-2" }));
    expect(detached.reasons).toEqual(["localOnlyRecent", "detached"]);
  });

  it("lists changes in progress and stashes", () => {
    const [mygame] = buildProjects(doc, full, gitOf, settings, NOW);
    expect(mygame.changes.map((c) => [c.slot.name, c.branch, c.changes, c.detail?.staged])).toEqual([["MyGame", "master", 2, 1]]);
    expect(mygame.stashes.map((s) => [s.holders, s.stash.message])).toEqual([[["MyGame"], "On master: wip"]]);
    expect(mygame.pendingFull).toBe(false);
  });

  it("takes checkouts from the folders of a basic refresh: a branch made since the last full one is pending", () => {
    const basic = full.map((r) =>
      r.commonDir.endsWith("MyGame-1/.git")
        ? { ...r, level: "basic" as const, branches: null, stashes: null, folders: [{ ...r.folders![0], branch: "feature/new", head: "n1" }] }
        : { ...r, level: "basic" as const, branches: null, stashes: null },
    );
    const merged = mergeRepos(basic, fullRepos(doc))!;
    const [mygame] = buildProjects(doc, merged, gitOf, settings, NOW);
    const added = mygame.groups.find((g) => g.name === "feature/new")!;
    expect(added).toMatchObject({ level: "info", reasons: ["pending"], checkedOut: true });
    expect(added.copies[0].tip).toBe("n1");
    // The branch it left is no longer checked out anywhere
    expect(mygame.groups.find((g) => g.name === "feature/rec")!.checkedOut).toBe(false);

    // Before any full answer only the checked-out branches are known
    const [first] = buildProjects(doc, basic, gitOf, settings, NOW);
    expect(first.pendingFull).toBe(true);
    expect(first.groups.filter((g) => !g.detached).map((g) => [g.name, g.reasons])).toEqual([
      ["feature/new", ["pending"]],
      ["master", ["pending"]],
    ]);
  });

  it("filters, counts and finds a slot's branches", () => {
    const projects = buildProjects(doc, full, gitOf, settings, NOW);
    const [mygame] = projects;
    const clean = mygame.groups.filter((g) => !passesFilter(g, "attention"));
    expect(clean).toEqual([]);
    expect(mygame.groups.filter((g) => passesFilter(g, "checkedout")).map((g) => g.name).sort()).toEqual(
      ["feature/rec", "master", t("branch.detachedName", { slot: "MyGame-2" })].sort(),
    );
    expect(projects[1].groups.filter((g) => !passesFilter(g, "attention")).map((g) => g.name)).toEqual(["master"]);
    expect(branchCounts(projects)).toEqual({ total: mygame.groups.length + 1, attention: 3 });
    expect(mygame.groups.filter((g) => inSlot(g, "MyGame-1")).map((g) => g.name).sort()).toEqual(["feature/rec", "master"]);
  });

  it("finds the project's view repository, what changed since and the ref names", () => {
    const [mygame, other] = buildProjects(doc, full, gitOf, settings, NOW);
    expect(mygame.view?.path).toBe("D:/view/MyGame.git");
    expect(other.view).toBeNull();
    expect(viewChanged(mygame.view)).toBe(2);
    const rec = mygame.groups.find((g) => g.name === "feature/rec")!;
    expect(viewRef(mygame.view, rec.copies[1])).toBe("MyGame-1/feature/rec");
    expect(viewRef(null, rec.copies[1])).toBeNull();
  });

  it("writes a cleanup request for one branch's copies", () => {
    const [mygame] = buildProjects(doc, full, gitOf, settings, NOW);
    const master = mygame.groups.find((g) => g.name === "master")!;
    const text = branchCleanupRequest(master, slots, NOW, NOW.toISOString());
    expect(text.split("\n")[0]).toBe(t("cleanup.titleBranch", { branch: "master", project: "MyGame", time: "12:00" }));
    expect(text).toContain("- [ ] MyGame-2 (C:/repo/MyGame-2): tip m2 · origin/master ↑2 ↓0");
    expect(text).toContain(`${t("cleanup.checkedOutBy", { slots: "MyGame" })}`);
    expect(text).toContain(t("branch.verdict.ahead-copy", { tips: 2, n: 3 }));
  });

  it("gives a repository without branches only its checked-out branch", () => {
    const copies = repoCopies(repo("X", null, "main"), ["X"], settings, NOW);
    expect(copies.map((c) => [c.name, c.pending, c.tip])).toEqual([["main", true, "main-head"]]);
  });
});
