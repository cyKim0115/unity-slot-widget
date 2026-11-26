/**
 * What the small widget lists (mini.html, src-tauri/src/mini.rs): only the slots whose editor is
 * open, in a steady order (the project as people read it, then the slot name) so a row keeps its
 * place while others come and go. A row: state dot, name, platform and memory; under it the state
 * and how long the editor has been open, the lease and the branch. Values go through `esc`.
 */
import { projectLabel } from "../aliases";
import { formatGb, t } from "../i18n";
import { groupName, isOpen } from "../model";
import { SUPPORTED_SCHEMA_MAJOR, type Dashboard, type DashboardResult, type Slot, type WidgetSettings } from "../types";
import { esc, nameHtml, platformChip, shortOwner, since, tint } from "../view";

/** Order of the rows: project (its nickname), then slot name. */
export function sortKey(slot: Slot): string {
  return `${projectLabel(groupName(slot)).toLowerCase()}\u0000${slot.name.toLowerCase()}`;
}

/** The slots with an open editor (starting, ready, stalled, batch run, unknown), in row order. */
export function openSlots(doc: Dashboard | null): Slot[] {
  return (doc?.slots ?? [])
    .filter(isOpen)
    .map((slot) => ({ slot, key: sortKey(slot) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.slot);
}

/** A row's key in the list (the slot name). */
export const rowKey = (slot: Slot): string => `s:${slot.name}`;

function subParts(slot: Slot, now: Date): string[] {
  const editor = slot.editor;
  const state = editor?.state ?? "closed";
  const parts: string[] = [];
  const open = state === "ready" || state === "unknown" || state === "starting" || state === "stalled";
  parts.push(`${esc(t(`state.${state}`))}${open && editor?.startedAt ? ` ${since(editor.startedAt, now)}` : ""}`);
  const lease = slot.lease;
  if (lease?.owner) {
    let text = esc(t("row.lease", { owner: shortOwner(lease.owner) }));
    if (lease.expired) text += ` <span class="hot-text">${esc(t("row.leaseExpired"))}</span>`;
    else if (lease.client?.alive === false) text += ` <span class="warn-text">${esc(t("row.leaseClientGone"))}</span>`;
    parts.push(`<span class="lease" title="${esc(lease.owner)}">${text}</span>`);
  }
  const branch = slot.git?.branch;
  if (branch) parts.push(`<span class="branch" title="${esc(branch)}">${esc(branch)}</span>`);
  return parts;
}

/** One row. `data-slot` is what a press opens in the main window. */
export function miniRow(slot: Slot, now: Date, settings: Pick<WidgetSettings, "slotMemoryWarnGb">): string {
  const state = slot.editor?.state ?? "closed";
  const gb = slot.editor?.memory?.totalPrivGB;
  const memory =
    typeof gb === "number"
      ? `<span class="mem${gb >= settings.slotMemoryWarnGb ? " warn" : ""}" title="${esc(t("detail.memory"))}">${esc(formatGb(gb))}G</span>`
      : "";
  const project = projectLabel(groupName(slot));
  const sub = subParts(slot, now)
    .map((p) => `<span class="part">${p}</span>`)
    .join('<span class="sep">·</span>');
  // Only the red tint: the widget stays calm, the yellow cases (starting, no lease) read from the text
  const hot = tint(slot) === "tint-hot" ? "tint-hot" : "";
  return `<li class="mrow state-${esc(state)} ${hot}" data-key="${esc(rowKey(slot))}" data-sort="${esc(sortKey(slot))}" data-slot="${esc(slot.name)}" title="${esc(`${slot.name} · ${project}\n${t("mini.hint")}`)}">
    <div class="mrow-in">
      <span class="dot" aria-hidden="true"></span>
      <div class="mrow-text">
        <div class="mrow-head">${nameHtml(slot.name, "name", slot.name)}${platformChip(slot.platform)}${memory}</div>
        <div class="mrow-sub">${sub}</div>
      </div>
    </div>
  </li>`;
}

/** The only row while the slots cannot be read and nothing was read before. */
export function errorRow(): string {
  return `<li class="mrow mrow-error tint-warn" data-key="error" data-sort="">
    <div class="mrow-in"><span class="mrow-text"><span class="mrow-sub warn-text">${esc(t("mini.error"))}</span></span></div>
  </li>`;
}

/** The last slot document the app read (src-tauri/src/mini.rs `mini_cached`, event `mini-dashboard`). */
export interface Cached {
  result: DashboardResult;
  /** Wall time it was read, ms since 1970. */
  receivedAt: number;
}

/** A remembered document older than this is not drawn; the widget waits for its own read. */
export const CACHE_MAX_MS = 10 * 60_000;

/** The document is one this app reads (schema major), else an error code like the refresh throws. */
export function checkSchema(doc: Dashboard): void {
  const major = /\/(\d+)/.exec(doc.schema ?? "");
  if (!major || Number(major[1]) !== SUPPORTED_SCHEMA_MAJOR) throw `schema:${doc.schema}`;
}

/**
 * The remembered document to draw now: readable, not older than CACHE_MAX_MS, and newer than the
 * one on screen (`shownAt`, 0 for none). Null otherwise.
 */
export function usableCache(cached: Cached | null | undefined, now: number, shownAt: number): Cached | null {
  if (!cached?.result?.document || !Number.isFinite(cached.receivedAt)) return null;
  if (now - cached.receivedAt > CACHE_MAX_MS || cached.receivedAt <= shownAt) return null;
  try {
    checkSchema(cached.result.document);
  } catch {
    return null;
  }
  return cached;
}

/** The row without its running times: the same signature means the row need not be drawn again. */
export function rowSignature(html: string): string {
  return html.replace(/(<span data-since="[^"]*">)[^<]*/g, "$1");
}
