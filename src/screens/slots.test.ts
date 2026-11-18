import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ALIAS_MAX_CHARS, cleanAlias, projectAlias, projectLabel, receiveAliases } from "../aliases";
import { setLang } from "../i18n";
import { sharedRepos } from "../model";
import { defaultSettings } from "../settings";
import type { Dashboard, GitState, Slot } from "../types";
import { nameHtml, splitName, type RowContext } from "../view";
import { buildSlotList, EXTRA_KEY, groupBody, groupKey, type ListState, parseKey, repoLabel, slotKey, slotListHtml } from "./slots";

const NOW = new Date("2026-11-16T12:00:00+09:00");

function slot(name: string, repo: string, state: NonNullable<Slot["editor"]>["state"], git: Partial<GitState> = {}): Slot {
  return {
    name,
    path: `C:\\repo\\${name}`,
    repo,
    editor: { state },
    git: { level: "full", branch: "master", commonDir: `C:\\repo\\${name}\\.git`, ...git },
  };
}

const doc: Dashboard = {
  schema: "unity-slot.dashboard/1",
  version: "0.6.1",
  slots: [
    slot("MyGame", "MyGame", "closed", { localOnly: { commits: 5, oldestAt: null }, stash: 1 }),
    slot("MyGame-release", "MyGame", "ready", {
      commonDir: "C:\\repo\\MyGame\\.git",
      localOnly: { commits: 5, oldestAt: null },
      stash: 1,
      branch: "build/webgl",
    }),
    slot("MyGame-1", "MyGame", "closed", { branch: "feature/x" }),
    slot("Popup", "Popup", "ready"),
  ],
  unregisteredEditors: [{ pid: 4420, project: "C:\\Sandbox" }],
  orphanWorkers: [],
};

function ctx(): RowContext {
  const gitOf = (s: Slot) => s.git ?? null;
  return { now: NOW, settings: defaultSettings(), gitOf, shared: sharedRepos(doc.slots ?? [], gitOf) };
}

const base: ListState = { filter: "all", project: null, find: "", collapsed: new Set(), warned: new Set() };

describe("slot list", () => {
  beforeAll(() => setLang("en"));

  it("reads item keys, and a bare name saved by an older version as a slot", () => {
    expect(parseKey("s:MyGame-1")).toEqual({ kind: "slot", name: "MyGame-1" });
    expect(parseKey("g:MyGame")).toEqual({ kind: "group", name: "MyGame" });
    expect(parseKey(EXTRA_KEY)).toEqual({ kind: "extra" });
    expect(parseKey("e:4420")).toEqual({ kind: "editor", pid: 4420 });
    expect(parseKey("w:x")).toBeNull();
    expect(parseKey("MyAwesomeProject-1")).toEqual({ kind: "slot", name: "MyAwesomeProject-1" });
    expect(parseKey(null)).toBeNull();
  });

  it("orders groups, open slots first, then editors outside the registry", () => {
    const view = buildSlotList(doc, base, ctx());
    expect(view.keys).toEqual([
      groupKey("MyGame"),
      slotKey("MyGame-release"),
      slotKey("MyGame"),
      slotKey("MyGame-1"),
      groupKey("Popup"),
      slotKey("Popup"),
      EXTRA_KEY,
      "e:4420",
    ]);
    expect(view.groups[0].repos.map((r) => r.slots.map((s) => s.name))).toEqual([["MyGame", "MyGame-release"]]);
  });

  it("filters by project, state, warning and find text; a folded group keeps only its head", () => {
    const c = ctx();
    expect(buildSlotList(doc, { ...base, project: "Popup" }, c).keys).toEqual([groupKey("Popup"), slotKey("Popup")]);
    expect(buildSlotList(doc, { ...base, filter: "open" }, c).keys).toEqual([
      groupKey("MyGame"),
      slotKey("MyGame-release"),
      groupKey("Popup"),
      slotKey("Popup"),
      EXTRA_KEY,
      "e:4420",
    ]);
    expect(buildSlotList(doc, { ...base, filter: "attention", warned: new Set(["MyGame-1"]) }, c).keys).toEqual([
      groupKey("MyGame"),
      slotKey("MyGame-1"),
    ]);
    expect(buildSlotList(doc, { ...base, find: "feature/" }, c).keys).toEqual([groupKey("MyGame"), slotKey("MyGame-1")]);
    expect(buildSlotList(doc, { ...base, find: "sandbox" }, c).keys).toEqual([EXTRA_KEY, "e:4420"]);
    const folded = buildSlotList(doc, { ...base, collapsed: new Set([groupKey("MyGame"), EXTRA_KEY]) }, c);
    expect(folded.keys).toEqual([groupKey("MyGame"), groupKey("Popup"), slotKey("Popup"), EXTRA_KEY]);
    // Finding opens every group
    expect(buildSlotList(doc, { ...base, find: "release", collapsed: new Set([groupKey("MyGame")]) }, c).keys).toEqual([
      groupKey("MyGame"),
      slotKey("MyGame-release"),
    ]);
  });

  it("draws the shared repository's numbers once, on the group head", () => {
    const c = ctx();
    const html = slotListHtml(buildSlotList(doc, base, c), c);
    const box = document.createElement("div");
    box.innerHTML = html;
    const head = box.querySelector(`[data-item="${groupKey("MyGame")}"]`)!;
    expect(head.querySelectorAll(".repo-line")).toHaveLength(1);
    expect(head.querySelector(".repo-line")!.textContent).toContain("5");
    // The two slots of that repository carry no repository numbers; the clone keeps its own row
    const rowStats = (name: string) => box.querySelector(`[data-item="${slotKey(name)}"] .pills`)?.textContent ?? "";
    expect(rowStats("MyGame")).toBe("");
    expect(rowStats("MyGame-release")).toBe("");
    expect(box.querySelectorAll("[role=treeitem][aria-level='1']")).toHaveLength(3);
    expect(box.querySelector(`[data-item="${groupKey("MyGame")}"]`)!.getAttribute("aria-expanded")).toBe("true");
  });

  it("names a shared repository by the folder that holds it", () => {
    expect(repoLabel("C:\\repo\\MyGame\\.git")).toBe("MyGame");
    expect(repoLabel("C:/hub/MyGame.git")).toBe("MyGame");
  });
});

describe("names shortened in the middle", () => {
  it("keeps short names whole and the clone number of long ones", () => {
    expect(splitName("MyGame-1")).toEqual(["MyGame-1", ""]);
    expect(splitName("MyAwesomeProject-1")).toEqual(["MyAwesomeP", "roject-1"]);
    const [head, tail] = splitName("MyStudioCompany-ShowcaseDemo-3");
    expect(head + tail).toBe("MyStudioCompany-ShowcaseDemo-3");
    expect(tail).toBe("seDemo-3");
    expect(splitName("MyStudioCompany-ShowcaseDemo")[1]).toBe("ShowcaseDemo");
  });

  it("escapes and keeps the whole name as the title", () => {
    const box = document.createElement("div");
    box.innerHTML = nameHtml("<Long>-Name-With-Number-12");
    const el = box.firstElementChild as HTMLElement;
    expect(el.title).toBe("<Long>-Name-With-Number-12");
    expect(el.textContent).toBe("<Long>-Name-With-Number-12");
  });
});

describe("project nicknames", () => {
  beforeAll(() => setLang("en"));
  afterEach(() => receiveAliases({}));

  it("shows the nickname on the group head and keeps the real name for keys and the title", () => {
    receiveAliases({ MyGame: "  Main game  " });
    const view = buildSlotList(doc, base, ctx());
    const box = document.createElement("div");
    box.innerHTML = slotListHtml(view, ctx());
    const head = box.querySelector(`[data-item="${groupKey("MyGame")}"]`)!;
    const name = head.querySelector(".group-name") as HTMLElement;
    expect(name.textContent).toBe("Main game");
    expect(name.title).toBe("MyGame");
    expect(head.getAttribute("aria-label")).toMatch(/^Main game /);
    expect(box.querySelector('[data-group="MyGame"]')).not.toBeNull();
    // Without one the name shows as before
    expect((box.querySelector(`[data-item="${groupKey("Popup")}"] .group-name`) as HTMLElement).textContent).toBe("Popup");
  });

  it("finds a project by its nickname or its name", () => {
    receiveAliases({ MyGame: "Main game" });
    expect(buildSlotList(doc, { ...base, find: "main g" }, ctx()).groups.map((g) => g.name)).toEqual(["MyGame"]);
    expect(buildSlotList(doc, { ...base, find: "mygame" }, ctx()).groups.map((g) => g.name)).toEqual(["MyGame"]);
  });

  it("offers renaming in the group details and shows the original name there", () => {
    receiveAliases({ MyGame: "Main game" });
    const g = buildSlotList(doc, base, ctx()).groups.find((x) => x.name === "MyGame")!;
    const box = document.createElement("div");
    box.innerHTML = groupBody(g, ctx(), false);
    expect(box.querySelector('[data-act="rename-project"]')?.getAttribute("data-project")).toBe("MyGame");
    expect(box.textContent).toContain("Original name");
    receiveAliases({});
    box.innerHTML = groupBody(g, ctx(), false);
    expect(box.textContent).not.toContain("Original name");
  });

  it("drops empty nicknames, nicknames equal to the name and values that are not text", () => {
    expect(receiveAliases({ A: "", B: "B", C: 3, D: " d\t ", "": "x" })).toBe(true);
    expect([projectAlias("A"), projectAlias("B"), projectAlias("C"), projectAlias("")]).toEqual([null, null, null, null]);
    expect(projectLabel("D")).toBe("d");
    expect(projectLabel("A")).toBe("A");
    // The same map again is no change; a cleared one is
    expect(receiveAliases({ D: "d" })).toBe(false);
    expect(receiveAliases(null)).toBe(true);
    expect(cleanAlias(`${"x".repeat(ALIAS_MAX_CHARS)}yz `)).toHaveLength(ALIAS_MAX_CHARS);
  });
});
