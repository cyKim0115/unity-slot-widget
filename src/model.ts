/**
 * Pure derivations from the dashboard document. The core already decides slot states and most
 * flags; the widget adds only what depends on its own settings (commit, memory and
 * local-only age thresholds) and merges the last full git result into basic refreshes.
 */
import type { Dashboard, GitState, Slot, WidgetSettings } from "./types";
import { formatDuration, formatWhen, t } from "./i18n";

export type Severity = "critical" | "warn" | "info";

export interface Warning {
  severity: Severity;
  text: string;
  slot?: string;
}

const DAY = 86_400_000;

/** Flags the widget recomputes from its own settings, so the core's copy is skipped. */
const WIDGET_OWNED_FLAGS = new Set(["local-only-old", "commit-high", "commit-critical"]);

const FLAG_SEVERITY: Record<string, Severity> = {
  stalled: "critical",
  "lease-expired-open": "critical",
  "missing-path": "critical",
  "open-without-lease": "warn",
  "unsaved-scene": "warn",
  "lease-expiring": "warn",
  "stale-lock": "warn",
  "editors-at-max": "warn",
  "batch-running": "info",
};

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

export function warnings(doc: Dashboard, settings: WidgetSettings, now: Date, gitOf: (s: Slot) => GitState | null): Warning[] {
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

  for (const slot of doc.slots ?? []) {
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
    const git = gitOf(slot);
    const days = localOnlyDays(git, now);
    if (days !== null && days >= settings.localOnlyWarnDays) {
      list.push({
        severity: days >= settings.localOnlyCriticalDays ? "critical" : "warn",
        slot: slot.name,
        text: t("flag.local-only-old", { slot: slot.name, n: git?.localOnly?.commits ?? 0, days }),
      });
    }
  }
  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return list.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Markdown checklist an agent session can work through, asking before each change. */
export function cleanupRequest(doc: Dashboard, now: Date, gitOf: (s: Slot) => GitState | null): string | null {
  const lines: string[] = [];
  for (const slot of doc.slots ?? []) {
    const parts: string[] = [];
    const git = gitOf(slot);
    const localOnly = git?.localOnly?.commits ?? 0;
    if (localOnly > 0) {
      parts.push(
        git?.localOnly?.oldestAt
          ? t("git.localOnlySince", { n: localOnly, date: formatWhen(git.localOnly.oldestAt, now) })
          : t("git.localOnly", { n: localOnly }),
      );
    }
    if ((git?.ahead ?? 0) > 0) parts.push(t("git.ahead", { n: git?.ahead ?? 0 }));
    if ((git?.branches?.noUpstream ?? 0) > 0) parts.push(t("git.noUpstream", { n: git?.branches?.noUpstream ?? 0 }));
    if ((git?.branches?.upstreamGone ?? 0) > 0) parts.push(t("git.gone", { n: git?.branches?.upstreamGone ?? 0 }));
    if ((git?.stash ?? 0) > 0) parts.push(t("git.stash", { n: git?.stash ?? 0 }));
    if ((git?.changes ?? 0) > 0) parts.push(t("git.changes", { n: git?.changes ?? 0 }));
    for (const flag of slot.flags ?? []) {
      if (flag === "open-without-lease" || flag === "lease-expired-open" || flag === "unsaved-scene") {
        const gb = slot.editor?.memory?.totalPrivGB;
        parts.push(t(`flag.${flag}`, { slot: "", gb: typeof gb === "number" ? gb.toFixed(1) : "?" }).trim());
      }
    }
    if (parts.length) lines.push(`- [ ] ${slot.name} (${slot.path}): ${parts.join(" · ")}`);
  }
  if (!lines.length) return null;
  return [t("cleanup.title", { time: formatWhen(doc.time, now) }), "", ...lines, "", t("cleanup.fetchNote"), t("cleanup.request"), ""].join(
    "\n",
  );
}
