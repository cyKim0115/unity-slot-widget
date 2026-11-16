/**
 * The state at a glance while the window is out of sight (minimized, behind other windows, hidden
 * to the tray): one status line for the tray tooltip, a level for the taskbar badge, and the risks
 * that flash the taskbar button when they are new (a stalled start, critical commit charge).
 * Rust draws and sets them (src-tauri/src/overlay.rs, `set_glance`). A stalled start and a critical
 * commit charge are decided by the same rules as the banner (model.ts `urgentItems`).
 */

import { t } from "./i18n";
import { commitCritical, isOpen, stalledSlots, type Warning } from "./model";
import type { Dashboard, WidgetSettings } from "./types";

/** critical: red badge, warn: amber, ok: green, none: no badge (nothing known yet). */
export type GlanceLevel = "critical" | "warn" | "ok" | "none";

export interface Glance {
  level: GlanceLevel;
  /** 「에디터 5/6 · 멈춤 1 · 경고 5」 */
  status: string;
  /** Keys of what needs a person now; a key that was not there before flashes the taskbar. */
  risks: string[];
}

export interface GlanceInput {
  doc: Dashboard | null;
  warnings: Warning[] | null;
  settings: Pick<WidgetSettings, "commitWarnPercent" | "commitCriticalPercent">;
  /** The last refresh failed (the document on screen, if any, is older). */
  error: boolean;
  /** Hidden to the tray: refreshing has stopped. */
  paused: boolean;
}

const RANK: Record<GlanceLevel, number> = { none: 0, ok: 1, warn: 2, critical: 3 };
const worse = (a: GlanceLevel, b: GlanceLevel): GlanceLevel => (RANK[a] >= RANK[b] ? a : b);

export function glance({ doc, warnings, settings, error, paused }: GlanceInput): Glance {
  const parts: string[] = [];
  const risks: string[] = [];
  let level: GlanceLevel = "none";
  if (doc) {
    const slots = doc.slots ?? [];
    const open = doc.system?.editorsOpen ?? slots.filter(isOpen).length;
    const max = doc.registry?.maxEditors ?? slots.length;
    parts.push(t("status.editors", { open, max }));
    const stalled = stalledSlots(doc);
    if (stalled.length) parts.push(t("tray.stalled", { n: stalled.length }));
    const percent = doc.system?.commit?.percent;
    const commitWarn = typeof percent === "number" && percent >= settings.commitWarnPercent;
    const critical = commitCritical(doc, settings) !== null;
    if (commitWarn) parts.push(t("header.commit", { percent: percent! }));
    const counted = (warnings ?? []).filter((w) => w.severity !== "info");
    if (counted.length) parts.push(t("status.warnings", { n: counted.length }));

    level = "ok";
    if (counted.length || commitWarn) level = "warn";
    if (stalled.length || critical || counted.some((w) => w.severity === "critical")) level = "critical";
    for (const s of stalled) risks.push(`stalled:${s.name}`);
    if (critical) risks.push("commit-critical");
  } else if (!error) {
    parts.push(t("footer.loading"));
  }
  // The app cannot see the slots (core missing, failing): at least attention
  if (error) {
    parts.push(t("status.noAnswer"));
    level = worse(level, "warn");
  }
  if (paused) parts.push(t("footer.paused"));
  return { level, status: parts.join(" · "), risks };
}

/** Risks in `next` that were not in `known`. */
export function newRisks(known: ReadonlySet<string>, next: readonly string[]): string[] {
  return next.filter((r) => !known.has(r));
}
