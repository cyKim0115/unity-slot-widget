import { beforeAll, describe, expect, it } from "vitest";
import { setLang, t } from "../i18n";
import { buildProjects } from "../branches";
import { defaultSettings } from "../settings";
import type { Dashboard, RepoGit, Slot } from "../types";
import {
  bBranchKey,
  bChangeKey,
  bChangesKey,
  bProjectKey,
  bRepoKey,
  bStashKey,
  branchesTabLabel,
  branchParentKey,
  buildBranchList,
  hasBranchViews,
  isBranchFoldKey,
  parseBranchKey,
  versionAtLeast,
} from "./branches";

const NOW = new Date("2026-11-16T12:00:00+09:00");

function slot(name: string, branch: string, changes = 0): Slot {
  return {
    name,
    path: `C:/repo/${name}`,
    project: "me/mygame",
    repo: "MyGame",
    editor: { state: "closed" },
    git: { level: "basic", branch, changes, commonDir: `C:/repo/${name}/.git`, changesDetail: { staged: 0, unstaged: changes, untracked: 0, conflicted: 0 } },
  };
}

function repo(name: string, branches: { name: string; tip: string; upstream?: string | null; local?: number }[], checkedOut: string): RepoGit {
  return {
    commonDir: `C:/repo/${name}/.git`,
    level: "full",
    folders: [{ path: `C:/repo/${name}`, slot: name, main: true, branch: checkedOut, head: "h" }],
    branches: branches.map((b) => ({
      name: b.name,
      tip: b.tip,
      upstream: b.upstream === undefined ? `origin/${b.name}` : b.upstream,
      upstreamGone: false,
      ahead: 0,
      behind: 0,
      localOnly: { commits: b.local ?? 0, oldestAt: b.local ? "2026-11-15T09:00:00+09:00" : null },
    })),
    stashes: [{ index: 0, sha: "s", at: null, branch: "master", message: "On master: wip" }],
  };
}

const doc: Dashboard = {
  schema: "unity-slot.dashboard/1",
  version: "0.7.0",
  slots: [slot("MyGame", "master", 2), slot("MyGame-1", "feature/x")],
  repos: [
    repo("MyGame", [{ name: "master", tip: "a" }, { name: "feature/x", tip: "b", upstream: null, local: 2 }], "master"),
    repo("MyGame-1", [{ name: "master", tip: "a" }, { name: "feature/x", tip: "c", upstream: null }], "feature/x"),
  ],
  branchViews: [],
};
const projects = () => buildProjects(doc, doc.repos!, (s) => s.git ?? null, defaultSettings(), NOW);

describe("branch screen keys", () => {
  it("round-trips names with slashes and odd characters", () => {
    const key = bBranchKey("My/Game", "feature/a b%c");
    expect(parseBranchKey(key)).toEqual({ kind: "branch", project: "My/Game", name: "feature/a b%c" });
    expect(parseBranchKey(bStashKey("MyGame", "c:/repo/mygame/.git", 3))).toEqual({ kind: "stash", project: "MyGame", repo: "c:/repo/mygame/.git", index: 3 });
    expect(parseBranchKey("s:MyGame")).toBeNull();
  });

  it("knows each item's head and which heads fold", () => {
    expect(branchParentKey(bBranchKey("MyGame", "master"))).toBe(bProjectKey("MyGame"));
    expect(branchParentKey(bChangeKey("MyGame", "MyGame"))).toBe(bChangesKey("MyGame"));
    expect(branchParentKey(bProjectKey("MyGame"))).toBeNull();
    expect([bProjectKey("x"), bChangesKey("x"), bRepoKey("x")].map(isBranchFoldKey)).toEqual([true, true, false]);
  });
});

describe("branch list", () => {
  beforeAll(() => setLang("en"));

  it("orders the head, the repository row, branches, changes, stashes and counts what the filter hides", () => {
    const view = buildBranchList(projects(), { filter: "attention", project: null, slot: null, find: "", collapsed: new Set() });
    expect(view.keys).toEqual([
      bProjectKey("MyGame"),
      bRepoKey("MyGame"),
      bBranchKey("MyGame", "feature/x"),
      bChangesKey("MyGame"),
      bChangeKey("MyGame", "MyGame"),
      "bs:MyGame",
      bStashKey("MyGame", "c:/repo/mygame/.git", 0),
      bStashKey("MyGame", "c:/repo/mygame-1/.git", 0),
    ]);
    // master is the same tip everywhere and up to date: clean, hidden
    expect(view.hidden).toBe(1);
  });

  it("limits to a slot, finds by name and folds heads", () => {
    const mine = buildBranchList(projects(), { filter: "all", project: null, slot: "MyGame-1", find: "", collapsed: new Set() });
    expect(mine.keys.filter((k) => k.startsWith("bc:"))).toEqual([]);
    expect(mine.keys.filter((k) => k.startsWith("bt:"))).toEqual([bStashKey("MyGame", "c:/repo/mygame-1/.git", 0)]);
    const found = buildBranchList(projects(), { filter: "all", project: null, slot: null, find: "FEATURE", collapsed: new Set([bProjectKey("MyGame")]) });
    expect(found.keys.filter((k) => k.startsWith("bb:"))).toEqual([bBranchKey("MyGame", "feature/x")]);
    const folded = buildBranchList(projects(), { filter: "all", project: null, slot: null, find: "", collapsed: new Set([bProjectKey("MyGame")]) });
    expect(folded.keys).toEqual([bProjectKey("MyGame")]);
  });

  it("labels the tab with every branch and the ones that need attention, or a dash before core 0.7.0", () => {
    expect(branchesTabLabel(doc, { total: 2, attention: 1 })).toBe(t("view.branchesWarn", { n: 2, warn: 1 }));
    expect(branchesTabLabel(doc, { total: 2, attention: 0 })).toBe(t("view.branches", { n: 2 }));
    expect(branchesTabLabel({ schema: "unity-slot.dashboard/1", version: "0.6.1" }, null)).toBe(t("view.branchesNone"));
  });

  it("offers view repositories only from core 0.7.0 with branchViews", () => {
    expect(versionAtLeast("0.7.0", [0, 7, 0])).toBe(true);
    expect(versionAtLeast("0.10.1", [0, 7, 0])).toBe(true);
    expect(versionAtLeast("0.6.9", [0, 7, 0])).toBe(false);
    expect(hasBranchViews(doc)).toBe(true);
    expect(hasBranchViews({ schema: "x", version: "0.7.0" })).toBe(false);
    expect(hasBranchViews({ schema: "x", version: "0.6.1", branchViews: [] })).toBe(false);
  });
});
