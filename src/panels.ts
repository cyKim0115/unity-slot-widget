/**
 * HTML for the side panel tabs (projects, warnings, recent events) and the details column.
 * Every value from the dashboard goes through `esc`. Rows carry `data-group` / `data-slot` so
 * main.ts can scroll to a group or select a slot.
 */
import type { Dashboard, Slot, SlotEvent, WidgetSettings } from "./types";
import { formatGb, formatWhen, t } from "./i18n";
import { isOpen, type Severity, type Warning } from "./model";
import { details, esc, platformChip, since, type RowContext } from "./view";

export function groupName(slot: Slot): string {
  return slot.repo || slot.project || "-";
}

// ---------------------------------------------------------------- projects

export function projectsPanel(doc: Dashboard | null, settings: WidgetSettings, warned: Set<string>): string {
  if (!doc) return `<p class="panel-empty">${esc(t("footer.loading"))}</p>`;
  const slots = doc.slots ?? [];
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = groupName(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const rows = [...groups].map(([name, members]) => {
    const open = members.filter(isOpen).length;
    const mark = members.some((s) => warned.has(s.name)) ? `<span class="sev warn" title="${esc(t("nav.warnings"))}"></span>` : "";
    return `<li><button type="button" class="panel-row" data-group="${esc(name)}" title="${esc(name)}">
      <span class="grow">${esc(name)}</span>${mark}<span class="side">${esc(t("row.openCount", { open, total: members.length }))}</span>
    </button></li>`;
  });

  const open = doc.system?.editorsOpen ?? slots.filter(isOpen).length;
  const max = doc.registry?.maxEditors ?? slots.length;
  const percent = doc.system?.commit?.percent;
  const commitClass =
    typeof percent !== "number"
      ? ""
      : percent >= settings.commitCriticalPercent
        ? "hot-text"
        : percent >= settings.commitWarnPercent
          ? "warn-text"
          : "";
  const summary: [string, string][] = [
    [t("panel.editors"), `<span class="${open >= max && max > 0 ? "warn-text" : ""}">${esc(`${open} / ${max}`)}</span>`],
    [t("panel.commit"), `<span class="${commitClass}">${esc(typeof percent === "number" ? `${percent}%` : t("detail.none"))}</span>`],
    [t("panel.free"), esc(`${formatGb(doc.system?.freePhysicalGB)} GB`)],
  ];
  const unreg = doc.unregisteredEditors?.length ?? 0;
  const orphans = doc.orphanWorkers?.length ?? 0;
  if (unreg > 0) summary.push([t("panel.unregistered"), `<span class="warn-text">${unreg}</span>`]);
  if (orphans > 0) summary.push([t("panel.orphans"), `<span class="warn-text">${orphans}</span>`]);

  return `${rows.length ? `<ul class="panel-list">${rows.join("")}</ul>` : `<p class="panel-empty">${esc(t("empty.noSlots"))}</p>`}
    <h3 class="panel-sub">${esc(t("panel.summary"))}</h3>
    <dl class="summary-grid">${summary.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

// ---------------------------------------------------------------- warnings

const SEVERITIES: Severity[] = ["critical", "warn", "info"];

export function warningsPanel(list: Warning[] | null): string {
  if (!list) return `<p class="panel-empty">${esc(t("footer.loading"))}</p>`;
  if (!list.length) return `<p class="panel-empty">${esc(t("panel.noWarnings"))}</p>`;
  return SEVERITIES.map((severity) => {
    const items = list.filter((w) => w.severity === severity);
    if (!items.length) return "";
    return `<h3 class="panel-sub">${esc(t(`panel.${severity}`))}</h3><ul class="panel-list">${items
      .map(
        (w) => `<li><button type="button" class="panel-row warn-row"${w.slot ? ` data-slot="${esc(w.slot)}"` : ""}>
          <span class="sev ${severity}" aria-hidden="true"></span><span class="grow">${esc(w.text)}</span>
        </button></li>`,
      )
      .join("")}</ul>`;
  }).join("");
}

// ---------------------------------------------------------------- recent events

export function logPanel(events: SlotEvent[] | null, now: Date): string {
  if (!events) return `<p class="panel-empty">${esc(t("footer.loading"))}</p>`;
  // Newest first whatever order the core sends (0.4 sends newest first, at most 20)
  const items = [...events].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0)).slice(0, 30);
  if (!items.length) return `<p class="panel-empty">${esc(t("events.empty"))}</p>`;
  return `<ul class="panel-list">${items
    .map((e) => {
      const name = t(`event.${e.event}`);
      const what = name.startsWith("event.") ? e.event : name;
      return `<li><button type="button" class="panel-row two-line log-row"${e.slot ? ` data-slot="${esc(e.slot)}"` : ""}>
        <span class="line1"><span class="time">${esc(formatWhen(e.time, now))}</span><span class="what">${esc(what)}</span><span class="grow">${esc(e.slot ?? "")}</span></span>
        ${e.owner ? `<span class="line2" title="${esc(e.owner)}">${esc(e.owner)}</span>` : ""}
      </button></li>`;
    })
    .join("")}</ul>`;
}

// ---------------------------------------------------------------- details column

export type UnityButton = { kind: "open" } | { kind: "focus" } | { kind: "off"; reason: string };

export function slotBody(slot: Slot, ctx: RowContext, unity: UnityButton, openTarget: string): string {
  const state = slot.editor?.state ?? "closed";
  const startedStates = ["ready", "unknown", "starting", "stalled"];
  const head: string[] = [
    `<span class="state-wrap state-${esc(state)}"><span class="dot"></span>${esc(t(`state.${state}`))}${
      startedStates.includes(state) ? ` ${since(slot.editor?.startedAt, ctx.now)}` : ""
    }</span>`,
  ];
  const chip = platformChip(slot.platform);
  if (chip) head.push(chip);
  if (slot.mode === "hot") head.push(`<span>${esc(t("mode.hot"))}</span>`);
  if (slot.agentUse === false) head.push(`<span>${esc(t("row.userOnly"))}</span>`);
  if (slot.lease?.owner) head.push(`<span title="${esc(slot.lease.owner)}">${esc(t("row.lease", { owner: slot.lease.owner }))}</span>`);

  const unityLabel =
    unity.kind === "open" ? t("menu.openUnity") : unity.kind === "focus" ? t("menu.focusUnity") : t("menu.openUnityOff", { reason: unity.reason });
  const buttons = [
    `<button type="button" class="act-btn" data-act="unity"${unity.kind === "off" ? " disabled" : ""}>${esc(unityLabel)}</button>`,
    `<button type="button" class="act-btn" data-act="open">${esc(t("menu.open", { app: t(`open.${openTarget}`) }))}</button>`,
    openTarget === "explorer" ? "" : `<button type="button" class="act-btn" data-act="explorer">${esc(t("menu.openExplorer"))}</button>`,
    `<button type="button" class="act-btn" data-act="log">${esc(t("btn.log"))}</button>`,
    `<button type="button" class="act-btn" data-act="copy">${esc(t("btn.copyPath"))}</button>`,
  ];
  return `<div class="body-state">${head.join('<span class="sep">·</span>')}</div>
    <div class="body-actions">${buttons.join("")}</div>
    ${details(slot, ctx)}`;
}

export function bodyMessage(text: string, opts: { error?: boolean; retry?: boolean; settings?: boolean; hint?: string } = {}): string {
  const buttons: string[] = [];
  if (opts.retry) buttons.push(`<button type="button" class="act-btn" data-act="retry">${esc(t("body.retry"))}</button>`);
  if (opts.settings) buttons.push(`<button type="button" class="act-btn" data-act="settings">${esc(t("menu.settings"))}</button>`);
  return `<div class="body-empty${opts.error ? " error" : ""}">
    <p>${esc(text)}</p>
    ${opts.hint ? `<p class="body-hint">${esc(opts.hint)}</p>` : ""}
    ${buttons.length ? `<div class="body-actions">${buttons.join("")}</div>` : ""}
  </div>`;
}
