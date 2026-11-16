import { beforeAll, describe, expect, it } from "vitest";
import { glance, newRisks } from "./glance";
import { setLang, t } from "./i18n";
import type { Warning } from "./model";
import type { Dashboard, Slot } from "./types";

const settings = { commitWarnPercent: 85, commitCriticalPercent: 90 };

function slot(name: string, state: NonNullable<Slot["editor"]>["state"]): Slot {
  return { name, path: `C:\\repo\\${name}`, editor: { state } };
}

function doc(slots: Slot[], percent = 60): Dashboard {
  return {
    schema: "unity-slot.dashboard/1",
    registry: { maxEditors: 6 },
    system: { commit: { percent }, editorsOpen: slots.filter((s) => s.editor?.state !== "closed").length },
    slots,
  };
}

const warn = (severity: Warning["severity"]): Warning => ({ severity, text: "x" });

describe("glance", () => {
  beforeAll(() => setLang("en"));

  it("is all right with nothing to look at", () => {
    const g = glance({ doc: doc([slot("A", "ready"), slot("B", "closed")]), warnings: [], settings, error: false, paused: false });
    expect(g).toEqual({ level: "ok", status: t("status.editors", { open: 1, max: 6 }), risks: [] });
  });

  it("puts the worst first: stalled starts, commit, warnings", () => {
    const g = glance({
      doc: doc([slot("A", "stalled"), slot("B", "ready")], 92),
      warnings: [warn("critical"), warn("warn"), warn("info")],
      settings,
      error: false,
      paused: false,
    });
    expect(g.level).toBe("critical");
    expect(g.status).toBe(
      [t("status.editors", { open: 2, max: 6 }), t("tray.stalled", { n: 1 }), t("header.commit", { percent: 92 }), t("status.warnings", { n: 2 })].join(" · "),
    );
    expect(g.risks).toEqual(["stalled:A", "commit-critical"]);
  });

  it("is attention for warnings or a high commit charge only", () => {
    expect(glance({ doc: doc([], 86), warnings: [], settings, error: false, paused: false }).level).toBe("warn");
    expect(glance({ doc: doc([]), warnings: [warn("warn")], settings, error: false, paused: false }).level).toBe("warn");
    expect(glance({ doc: doc([]), warnings: [warn("info")], settings, error: false, paused: false }).level).toBe("ok");
  });

  it("says when nothing is known, the core does not answer or refreshing stopped", () => {
    expect(glance({ doc: null, warnings: null, settings, error: false, paused: false })).toEqual({
      level: "none",
      status: t("footer.loading"),
      risks: [],
    });
    expect(glance({ doc: null, warnings: null, settings, error: true, paused: false }).level).toBe("warn");
    const stale = glance({ doc: doc([slot("A", "ready")]), warnings: [], settings, error: true, paused: true });
    expect(stale.level).toBe("warn");
    expect(stale.status).toBe([t("status.editors", { open: 1, max: 6 }), t("status.noAnswer"), t("footer.paused")].join(" · "));
  });

  it("finds risks that are new", () => {
    expect(newRisks(new Set(["stalled:A"]), ["stalled:A", "commit-critical"])).toEqual(["commit-critical"]);
    expect(newRisks(new Set(), [])).toEqual([]);
  });
});
