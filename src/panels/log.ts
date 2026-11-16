/**
 * Side panel [L]: the core's recent events, newest first. A row about a slot selects it.
 */
import type { SlotEvent } from "../types";
import { formatWhen, t } from "../i18n";
import { esc } from "../view";

export function logPanel(events: readonly SlotEvent[] | null, now: Date): string {
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
