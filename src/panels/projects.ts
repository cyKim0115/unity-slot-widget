/**
 * Side panel [P]: one row per project (open count, layout, fetch range; a mark when one of its
 * slots has a warning) under an 「전체」 row, then the summary (editors, commit charge, free memory,
 * editors and workers outside the registry). Pressing a project row shows only that project in the
 * list (the same state as the list's project button); `data-project=""` is every project. Under a
 * project, `extra` may add a line (main.ts: the view repository and its button, core 0.7.0).
 */
import type { Dashboard, Slot, WidgetSettings } from "../types";
import { formatGb, t } from "../i18n";
import { isOpen, projectGroups } from "../model";
import { layoutLine } from "../screens/slots";
import { esc, nameHtml, type RowContext } from "../view";

function projectRow(value: string, label: string, members: Slot[], current: boolean, mark: string, line: string, extra = ""): string {
  const open = members.filter(isOpen).length;
  return `<li><button type="button" class="panel-row project-row${line ? " two-line" : ""}" data-project="${esc(value)}" aria-pressed="${current}">
    <span class="line1">${nameHtml(label, "grow")}${mark}<span class="side">${esc(t("row.openCount", { open, total: members.length }))}</span></span>
    ${line ? `<span class="line2">${esc(line)}</span>` : ""}
  </button>${extra}</li>`;
}

export function projectsPanel(
  doc: Dashboard | null,
  settings: WidgetSettings,
  warned: ReadonlySet<string>,
  project: string | null,
  ctx: RowContext | null,
  extra: ((name: string, members: Slot[]) => string) | null = null,
): string {
  if (!doc || !ctx) return `<p class="panel-empty">${esc(t("footer.loading"))}</p>`;
  const slots = doc.slots ?? [];
  const warnMark = `<span class="sev warn" title="${esc(t("nav.warnings"))}"></span>`;
  const rows = [...projectGroups(slots)].map(([name, members]) =>
    projectRow(name, name, members, project === name, members.some((s) => warned.has(s.name)) ? warnMark : "", layoutLine(members, ctx), extra?.(name, members) ?? ""),
  );
  const all = projectRow("", t("panel.allProjects"), slots, project === null, "", "");

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
  // Pressing these shows their group at the end of the list
  const extraLink = (label: string, n: number) =>
    `<button type="button" class="link-btn warn-text" data-extra aria-label="${esc(`${label} ${n}`)}" title="${esc(t("status.extraTitle"))}">${esc(String(n))}</button>`;
  if (unreg > 0) summary.push([t("panel.unregistered"), extraLink(t("panel.unregistered"), unreg)]);
  if (orphans > 0) summary.push([t("panel.orphans"), extraLink(t("panel.orphans"), orphans)]);

  return `${slots.length ? `<ul class="panel-list">${all}${rows.join("")}</ul>` : `<p class="panel-empty">${esc(t("empty.noSlots"))}</p>`}
    <h3 class="panel-sub">${esc(t("panel.summary"))}</h3>
    <dl class="summary-grid">${summary.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}
