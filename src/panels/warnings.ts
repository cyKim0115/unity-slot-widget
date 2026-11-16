/**
 * Side panel [!n]: warnings by level (critical, attention, information). A row about a slot selects
 * it (`data-slot`); one about a repository several slots share selects the first of them.
 */
import { t } from "../i18n";
import type { Severity, Warning } from "../model";
import { esc } from "../view";

const SEVERITIES: Severity[] = ["critical", "warn", "info"];

export function warningsPanel(list: readonly Warning[] | null): string {
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
