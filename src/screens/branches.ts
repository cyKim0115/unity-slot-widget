/**
 * The branch screen's place. Until it lists branches by name (core 0.7.0 `repos[]`, the next app
 * step), it shows what every core reports: per git directory, the counts of local branches,
 * branches without or with a gone upstream, commits on no remote and stashes. With a core before
 * 0.7.0 it says that branch names need 0.7.0. 「이 슬롯 브랜치 보기」 brings the slot's repository
 * here (`focus`).
 */
import type { Dashboard } from "../types";
import { t } from "../i18n";
import { projectGroups, repoCounts, repoKey } from "../model";
import { esc, nameHtml, repoPills, type RowContext } from "../view";
import { repoLabel } from "./slots";

/** The core reports `repos` (0.7.0 and later): the key is there even when it is null. */
export function hasRepos(doc: Dashboard | null): boolean {
  return !!doc && "repos" in doc;
}

/** The screen tab: 「브랜치 —」 until branch names come. */
export function branchesTabLabel(doc: Dashboard | null): string {
  const repos = (doc as { repos?: { branches?: unknown[] | null }[] | null } | null)?.repos;
  if (!repos) return t("view.branchesNone");
  return t("view.branches", { n: repos.reduce((n, r) => n + (r.branches?.length ?? 0), 0) });
}

export function branchesNote(doc: Dashboard | null): string {
  return hasRepos(doc) ? t("branches.pending") : t("branches.needsCore", { version: doc?.version ?? "?" });
}

export function branchesPlaceholder(doc: Dashboard, project: string | null, ctx: RowContext, focus: string | null): string {
  const html: string[] = [`<p class="list-note">${esc(branchesNote(doc))}</p>`];
  for (const [name, members] of projectGroups(doc.slots ?? [])) {
    if (project !== null && name !== project) continue;
    const repos = new Map<string, { dir: string; slots: string[]; counts: ReturnType<typeof repoCounts> }>();
    for (const s of members) {
      const git = ctx.gitOf(s);
      const dir = git?.commonDir ?? s.path;
      const key = repoKey(dir);
      if (!repos.has(key)) repos.set(key, { dir, slots: [], counts: null });
      const r = repos.get(key)!;
      r.slots.push(s.name);
      r.counts ??= repoCounts(git);
    }
    const rows = [...repos.values()].map((r) => {
      const pills = repoPills(r.counts, ctx);
      const total = r.counts?.total;
      const focused = focus !== null && r.slots.includes(focus);
      return `<li class="repo-row${focused ? " focus" : ""}" title="${esc(r.dir)}">
        <div class="slot-head">${nameHtml(r.slots.length > 1 ? repoLabel(r.dir) : r.slots[0], "name")}
          <span class="head-end">${pills.length ? `<span class="pills">${pills.join("")}</span>` : ""}</span></div>
        <div class="slot-foot"><div class="slot-sub"><span class="part">${esc(
          typeof total === "number" ? t("branches.count", { n: total }) : t("detail.gitFullPending"),
        )}</span>${r.slots.length > 1 ? `<span class="sep">·</span><span class="part">${esc(r.slots.join(", "))}</span>` : ""}</div></div>
      </li>`;
    });
    html.push(`<section class="group" data-group="${esc(name)}">
      <div class="group-head static"><div class="group-line">${nameHtml(name, "group-name")}</div></div>
      <ul class="slots">${rows.join("")}</ul>
    </section>`);
  }
  return html.join("");
}
