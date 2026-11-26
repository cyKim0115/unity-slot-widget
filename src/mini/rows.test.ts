import { beforeEach, describe, expect, it } from "vitest";
import { receiveAliases } from "../aliases";
import { setLang, t } from "../i18n";
import type { Dashboard, Slot } from "../types";
import { miniRow, openSlots, rowSignature } from "./rows";

const slot = (name: string, state: string, extra: Partial<Slot> = {}): Slot =>
  ({ name, path: `C:\\${name}`, project: "org/game", editor: { state }, ...extra }) as Slot;

const doc = (slots: Slot[]): Dashboard => ({ schema: "unity-slot.dashboard/1", slots }) as Dashboard;

const NOW = new Date("2026-11-26T10:00:00Z");

describe("small widget rows", () => {
  beforeEach(() => {
    setLang("ko");
    receiveAliases({});
  });

  it("lists only open editors, by project and then name", () => {
    const list = openSlots(
      doc([
        slot("Game-2", "ready"),
        slot("Game-1", "closed"),
        slot("Alpha", "starting", { project: "org/alpha" }),
        slot("Game-10", "batch"),
        slot("Gone", "missing"),
        slot("Game-3", "stalled"),
      ]),
    );
    expect(list.map((s) => s.name)).toEqual(["Alpha", "Game-10", "Game-2", "Game-3"]);
    expect(openSlots(null)).toEqual([]);
  });

  it("orders projects by their nickname", () => {
    receiveAliases({ "org/game": "A game" });
    const list = openSlots(doc([slot("Alpha", "ready", { project: "org/alpha" }), slot("Game", "ready")]));
    expect(list.map((s) => s.name)).toEqual(["Game", "Alpha"]);
  });

  it("draws state and time, lease, branch and memory, escaped", () => {
    const html = miniRow(
      slot("Game<1>", "ready", {
        platform: "Android",
        editor: { state: "ready", startedAt: "2026-11-26T09:48:00Z", memory: { totalPrivGB: 12.3 } },
        lease: { owner: "claude", expired: true },
        git: { branch: "feature/x" },
      }),
      NOW,
      { slotMemoryWarnGb: 10 },
    );
    expect(html).toContain('data-slot="Game&lt;1&gt;"');
    expect(html).not.toContain("<1>");
    expect(html).toContain(t("state.ready"));
    expect(html).toContain('data-since="2026-11-26T09:48:00Z"');
    expect(html).toContain(t("dur.m", { n: 12 }));
    expect(html).toContain(t("row.lease", { owner: "claude" }));
    expect(html).toContain(t("row.leaseExpired"));
    expect(html).toContain("feature/x");
    expect(html).toContain('class="mem warn"');
    expect(html).toContain("AND");
  });

  it("keeps the same signature while only the running time changes", () => {
    const at = (now: string) =>
      miniRow(slot("Game", "starting", { editor: { state: "starting", startedAt: "2026-11-26T09:59:50Z" } }), new Date(now), {
        slotMemoryWarnGb: 10,
      });
    const a = at("2026-11-26T10:00:00Z");
    const b = at("2026-11-26T10:00:30Z");
    expect(a).not.toEqual(b);
    expect(rowSignature(a)).toEqual(rowSignature(b));
  });
});
