/**
 * The branch screen (core 0.7.0 `repos[]`): per project a group head, the repository row (layout,
 * fetch range, the view repository), its branches by name (most serious first, src/branches.ts
 * judges them), then 「작업 중인 변경 n」 and 「stash n」. Pure HTML builders; main.ts owns the state
 * (selection, filter, folded groups) and the events, as for the slot screen.
 *
 * Items carry a key in `data-item` (parts URI-encoded): `bg:<project>` group head, `br:<project>`
 * repository row, `bb:<project>/<branch>` branch, `bw:<project>` changes head, `bc:<project>/<slot>`
 * a slot's changes, `bs:<project>` stash head, `bt:<project>/<repo key>/<index>` a stash. The list is
 * a tree like the slot screen's.
 *
 * Right-click and the details buttons only read, copy and open; the one thing that writes is the
 * view repository button, which runs the core's `branch-view` (main.ts asks first when it makes one).
 * With a core before 0.7.0 the screen shows each repository's counts and says what is needed.
 */
import type { Dashboard, Slot } from "../types";
import { formatWhen, t } from "../i18n";
import {
  type BranchFilter,
  type BranchGroup,
  type ChangeItem,
  inSlot,
  type Level,
  passesFilter,
  type ProjectBranches,
  reasonText,
  shortSha,
  type StashItem,
  upstreamBranch,
  verdictText,
  viewChanged,
  viewRef,
} from "../branches";
import { daysSince, projectGroups, repoCounts, repoKey } from "../model";
import { projectAlias, projectLabel, projectMatches } from "../aliases";
import { icon } from "../icons";
import { bodyMessage, detailRow, esc, nameHtml, pill, projectNameHtml, repoPills, type RowContext } from "../view";
import { layoutLine, repoLabel } from "./slots";

// ---------------------------------------------------------------- core version

/** The core reports `repos` (0.7.0 and later): the key is there even when it is null. */
export function hasRepos(doc: Dashboard | null): boolean {
  return !!doc && "repos" in doc;
}

/** The core can make view repositories: 0.7.0 or later, with `branchViews` in its document. */
export function hasBranchViews(doc: Dashboard | null): boolean {
  return !!doc && "branchViews" in doc && versionAtLeast(doc.version, [0, 7, 0]);
}

export function versionAtLeast(version: string | null | undefined, want: [number, number, number]): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  for (let i = 0; i < 3; i++) {
    const a = Number(m[i + 1]);
    if (a !== want[i]) return a > want[i];
  }
  return true;
}

/** The screen tab: 「브랜치 31 !4」 (every project; `!` counts critical and attention), 「브랜치 —」 before 0.7.0. */
export function branchesTabLabel(doc: Dashboard | null, counts: { total: number; attention: number } | null): string {
  if (!hasRepos(doc) || !counts) return t("view.branchesNone");
  return counts.attention ? t("view.branchesWarn", { n: counts.total, warn: counts.attention }) : t("view.branches", { n: counts.total });
}

// ---------------------------------------------------------------- item keys

const enc = encodeURIComponent;
export const bProjectKey = (p: string): string => `bg:${enc(p)}`;
export const bRepoKey = (p: string): string => `br:${enc(p)}`;
export const bBranchKey = (p: string, name: string): string => `bb:${enc(p)}/${enc(name)}`;
export const bChangesKey = (p: string): string => `bw:${enc(p)}`;
export const bChangeKey = (p: string, slot: string): string => `bc:${enc(p)}/${enc(slot)}`;
export const bStashesKey = (p: string): string => `bs:${enc(p)}`;
export const bStashKey = (p: string, repo: string, index: number): string => `bt:${enc(p)}/${enc(repo)}/${index}`;

export type BranchRef =
  | { kind: "project"; project: string }
  | { kind: "repo"; project: string }
  | { kind: "branch"; project: string; name: string }
  | { kind: "changes"; project: string }
  | { kind: "change"; project: string; slot: string }
  | { kind: "stashes"; project: string }
  | { kind: "stash"; project: string; repo: string; index: number };

export function isBranchKey(key: string | null | undefined): boolean {
  return !!key && /^b[grbwcst]:/.test(key);
}

export function parseBranchKey(key: string | null | undefined): BranchRef | null {
  const m = /^b([grbwcst]):(.*)$/s.exec(key ?? "");
  if (!m) return null;
  const parts = m[2].split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [project, a, b] = parts;
  switch (m[1]) {
    case "g":
      return { kind: "project", project };
    case "r":
      return { kind: "repo", project };
    case "b":
      return a === undefined ? null : { kind: "branch", project, name: a };
    case "w":
      return { kind: "changes", project };
    case "c":
      return a === undefined ? null : { kind: "change", project, slot: a };
    case "s":
      return { kind: "stashes", project };
    default: {
      const index = Number(b);
      return a === undefined || !Number.isInteger(index) ? null : { kind: "stash", project, repo: a, index };
    }
  }
}

/** The item a key sits under: the project head, or the changes or stash head. */
export function branchParentKey(key: string): string | null {
  const ref = parseBranchKey(key);
  if (!ref) return null;
  switch (ref.kind) {
    case "project":
      return null;
    case "change":
      return bChangesKey(ref.project);
    case "stash":
      return bStashesKey(ref.project);
    default:
      return bProjectKey(ref.project);
  }
}

/** Heads that fold: the project, its changes and its stashes. */
export function isBranchFoldKey(key: string): boolean {
  return /^b[gws]:/.test(key);
}

// ---------------------------------------------------------------- the list

export interface BranchListState {
  filter: BranchFilter;
  /** One project (group name), or null for all. */
  project: string | null;
  /** 「이 슬롯 브랜치 보기」: only what this slot has. */
  slot: string | null;
  find: string;
  collapsed: ReadonlySet<string>;
}

export interface ProjectView {
  pb: ProjectBranches;
  key: string;
  collapsed: boolean;
  shown: BranchGroup[];
  /** Branches the filter hides (the find text and the slot filter are not counted). */
  hidden: number;
  changes: ChangeItem[];
  changesCollapsed: boolean;
  stashes: StashItem[];
  stashesCollapsed: boolean;
}

export interface BranchListView {
  projects: ProjectView[];
  keys: string[];
  hidden: number;
}

export function buildBranchList(all: readonly ProjectBranches[], state: BranchListState): BranchListView {
  const text = state.find.trim().toLowerCase();
  const finding = text !== "";
  const projects: ProjectView[] = [];
  const keys: string[] = [];
  let hidden = 0;
  for (const pb of all) {
    if (state.project !== null && pb.project !== state.project) continue;
    if (state.slot !== null && !pb.slots.some((s) => s.name === state.slot)) continue;
    const projectHit = finding && projectMatches(pb.project, text);
    const scoped = pb.groups.filter((g) => (state.slot === null || inSlot(g, state.slot)) && (!finding || projectHit || g.name.toLowerCase().includes(text)));
    const shown = scoped.filter((g) => passesFilter(g, state.filter));
    const changes = pb.changes.filter((c) => (state.slot === null || c.slot.name === state.slot) && (!finding || projectHit || c.slot.name.toLowerCase().includes(text) || (c.branch ?? "").toLowerCase().includes(text)));
    const stashes = pb.stashes.filter(
      (s) => (state.slot === null || s.holders.includes(state.slot)) && (!finding || projectHit || `${s.stash.message ?? ""} ${s.stash.branch ?? ""}`.toLowerCase().includes(text)),
    );
    if (finding && !shown.length && !changes.length && !stashes.length) continue;
    const key = bProjectKey(pb.project);
    const view: ProjectView = {
      pb,
      key,
      collapsed: !finding && state.collapsed.has(key),
      shown,
      hidden: scoped.length - shown.length,
      changes,
      changesCollapsed: !finding && state.collapsed.has(bChangesKey(pb.project)),
      stashes,
      stashesCollapsed: !finding && state.collapsed.has(bStashesKey(pb.project)),
    };
    hidden += view.hidden;
    projects.push(view);
    keys.push(key);
    if (view.collapsed) continue;
    keys.push(bRepoKey(pb.project), ...shown.map((g) => bBranchKey(pb.project, g.name)));
    if (changes.length) {
      keys.push(bChangesKey(pb.project));
      if (!view.changesCollapsed) keys.push(...changes.map((c) => bChangeKey(pb.project, c.slot.name)));
    }
    if (stashes.length) {
      keys.push(bStashesKey(pb.project));
      if (!view.stashesCollapsed) keys.push(...stashes.map((s) => bStashKey(pb.project, s.repoKey, s.stash.index)));
    }
  }
  return { projects, keys, hidden };
}

/** What the view repository button of a project does, or why it is off. */
export interface ViewAction {
  kind: "create" | "open";
  /** The reason it is off (old core, sample data, a run in progress, too few slots). */
  off: string | null;
}

export interface BranchContext extends RowContext {
  /** The last detailed git answer (ISO), or null. */
  lastFullAt: string | null;
  viewAction(project: ProjectBranches): ViewAction;
  /** A failed view run's message for the project, or null. */
  viewError(project: string): string | null;
  /** The project's view repository is being made or refreshed now. */
  viewRunning(project: string): boolean;
}

const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>';
const SEV_MARK: Record<Level, string> = { critical: "!!", warn: "!", info: "i", clean: "" };
/** Reasons that only restate the verdict of same-name copies. */
const VERDICT_REASONS: ReadonlySet<string> = new Set(["aheadCopy", "diverged", "behindOnly", "unknown"]);

function levelCounts(groups: readonly BranchGroup[]): Record<Level, number> {
  const out: Record<Level, number> = { critical: 0, warn: 0, info: 0, clean: 0 };
  for (const g of groups) out[g.level]++;
  return out;
}

function headPills(pb: ProjectBranches): string {
  const c = levelCounts(pb.groups);
  const out: string[] = [];
  if (c.critical) out.push(pill("hot", "!!", c.critical, t("branch.level.critical")));
  if (c.warn) out.push(pill("warn", "!", c.warn, t("branch.level.warn")));
  out.push(pill("plain", "", t("branches.count", { n: pb.groups.length }), t("branches.countTitle")));
  return `<span class="pills">${out.join("")}</span>`;
}

/** 「보기용 저장소 11:20 · 바뀜 2」 and its troubles, for the repository row and the side panel. */
export function viewLine(pb: ProjectBranches, ctx: Pick<BranchContext, "now" | "viewError" | "viewRunning">): { text: string; tone: "" | "warn" | "hot" } {
  if (ctx.viewRunning(pb.project)) return { text: t("bv.running"), tone: "" };
  const failed = ctx.viewError(pb.project);
  if (failed) return { text: t("bv.failedLine", { text: failed }), tone: "hot" };
  const v = pb.view;
  if (!v) return { text: t("bv.none"), tone: "" };
  if (v.error) return { text: t("bv.errorLine", { text: v.error }), tone: "hot" };
  const parts = [t("bv.updated", { time: formatWhen(v.updatedAt, ctx.now) })];
  const changed = viewChanged(v);
  if (changed) parts.push(t("bv.changed", { n: changed }));
  const rejected = v.origin?.rejected?.length ?? 0;
  if (rejected) parts.push(t("bv.originStale", { n: rejected }));
  const failedSlots = (v.slots ?? []).filter((s) => s.status === "failed").length;
  if (failedSlots) parts.push(t("bv.slotsFailed", { n: failedSlots }));
  return { text: parts.join(" · "), tone: rejected || failedSlots ? "warn" : "" };
}

function repoRow(pv: ProjectView, ctx: BranchContext): string {
  const pb = pv.pb;
  const layout = layoutLine(pb.slots, ctx);
  const view = viewLine(pb, ctx);
  const notes: string[] = [];
  if (pb.pendingFull) notes.push(`<span class="part">${esc(t("detail.gitFullPending"))}</span>`);
  const errors = pb.repos.filter((r) => r.repo.error).length;
  if (errors) notes.push(`<span class="part hot-text">${esc(t("branches.repoErrors", { n: errors }))}</span>`);
  return `<li class="item branch-item repo-item" role="treeitem" aria-level="2" data-item="${esc(bRepoKey(pb.project))}">
    <div class="slot-head"><span class="name">${esc(t("branches.repo"))}</span><span class="tags">${esc(layout)}</span></div>
    <div class="slot-foot"><div class="slot-sub"><span class="part${view.tone ? ` ${view.tone}-text` : ""}">${esc(view.text)}</span>${notes
      .map((n) => `<span class="sep">·</span>${n}`)
      .join("")}</div></div>
  </li>`;
}

/** The colored numbers at the end of a branch row. */
function branchPills(g: BranchGroup, ctx: Pick<RowContext, "now" | "settings">): string {
  const out: string[] = [];
  if (g.localOnly > 0) {
    const days = daysSince(g.localOnlyAt, ctx.now);
    const kind = days !== null && days >= ctx.settings.localOnlyCriticalDays ? "hot" : days !== null && days >= ctx.settings.localOnlyWarnDays ? "warn" : "local";
    const title = g.localOnlyAt ? t("git.localOnlySince", { n: g.localOnly, date: formatWhen(g.localOnlyAt, ctx.now) }) : t("git.localOnly", { n: g.localOnly });
    out.push(pill(kind, icon("cloudOff", 11), g.localOnly, title));
  }
  const tracked = g.copies.filter((c) => c.upstream && !c.upstreamGone);
  const ahead = Math.max(0, ...tracked.map((c) => c.ahead ?? 0));
  const behind = Math.max(0, ...tracked.map((c) => c.behind ?? 0));
  if (ahead) out.push(pill("push", "↑", ahead, t("git.ahead", { n: ahead })));
  if (behind) out.push(pill("pull", "↓", behind, t("git.behind", { n: behind })));
  if (g.copies.some((c) => c.upstreamGone)) out.push(pill("branch", icon("unlink", 11), "", t("branch.reason.gone")));
  if (g.tips > 1) out.push(pill("plain", "", t("branch.tips", { n: g.tips }), verdictText(g) ?? ""));
  const other = g.copies.find((c) => c.upstream && upstreamBranch(c.upstream) !== g.name);
  if (other?.upstream) out.push(pill("warn", "→", upstreamBranch(other.upstream), t("branch.reason.upstreamName", { upstream: other.upstream })));
  return out.length ? `<span class="pills">${out.join("")}</span>` : "";
}

function checkoutChips(g: BranchGroup): string {
  const names = [...new Set(g.copies.flatMap((c) => c.checkouts.map((k) => k.slot ?? k.path)))];
  if (!names.length) return `<span class="part">${esc(t("branch.noCheckout"))}</span>`;
  return `<span class="part co-list">${names.map((n) => `<span class="co" title="${esc(n)}">${esc(n)}</span>`).join("")}</span>`;
}

function branchRow(project: string, g: BranchGroup, ctx: BranchContext): string {
  const parts: string[] = [checkoutChips(g)];
  if (g.reasons.length) parts.push(`<span class="part">${esc(reasonText(g.reasons[0], g))}</span>`);
  if (g.copies.length > 1) parts.push(`<span class="part">${esc(g.verdict === "same" ? t("branch.copiesSame", { n: g.copies.length }) : t("branch.copies", { n: g.copies.length }))}</span>`);
  const newest = g.copies.map((c) => c.tipAt).filter((x): x is string => !!x).sort().pop();
  if (newest) parts.push(`<span class="part when">${esc(formatWhen(newest, ctx.now))}</span>`);
  const mark = SEV_MARK[g.level];
  return `<li class="item branch-item branch-row level-${g.level}" role="treeitem" aria-level="2" data-item="${esc(bBranchKey(project, g.name))}">
    <div class="slot-head">
      <span class="sev-mark sev-${g.level}" aria-label="${esc(t(`branch.level.${g.level}`))}">${esc(mark)}</span>
      ${nameHtml(g.name, "name branch-name")}
      <span class="head-end">${branchPills(g, ctx)}</span>
    </div>
    <div class="slot-foot"><div class="slot-sub">${parts.join('<span class="sep">·</span>')}</div></div>
  </li>`;
}

/** 「*4 (staged 1 · 수정 2 · 새 파일 1 · 충돌 0)」 */
export function changesText(item: Pick<ChangeItem, "changes" | "detail">): string {
  const d = item.detail;
  if (!d) return t("branch.changesN", { n: item.changes });
  return t("branch.changesDetail", { n: item.changes, staged: d.staged ?? 0, unstaged: d.unstaged ?? 0, untracked: d.untracked ?? 0, conflicted: d.conflicted ?? 0 });
}

function subHead(key: string, label: string, collapsed: boolean, rows: string): string {
  return `<li class="subgroup" role="none">
    <div class="item group-head sub-head" role="treeitem" aria-level="2" aria-expanded="${!collapsed}" data-item="${esc(key)}">
      <div class="group-line"><span class="fold" data-fold aria-hidden="true">${CHEVRON}</span><span class="group-name">${esc(label)}</span></div>
    </div>
    ${collapsed ? "" : `<ul class="slots" role="group" aria-label="${esc(label)}">${rows}</ul>`}
  </li>`;
}

function changeRows(project: string, items: readonly ChangeItem[]): string {
  return items
    .map(
      (c) => `<li class="item branch-item change-row" role="treeitem" aria-level="3" data-item="${esc(bChangeKey(project, c.slot.name))}">
      <div class="slot-head">${nameHtml(c.slot.name)}<span class="head-end">${pill("dirty", "●", c.changes, changesText(c))}</span></div>
      <div class="slot-foot"><div class="slot-sub"><span class="part"><span class="branch">${esc(c.branch ?? t("detail.none"))}</span></span><span class="sep">·</span><span class="part">${esc(
        changesText(c),
      )}</span></div></div>
    </li>`,
    )
    .join("");
}

function stashRows(project: string, items: readonly StashItem[], now: Date): string {
  return items
    .map((s) => {
      const message = s.stash.message ?? "";
      return `<li class="item branch-item stash-row" role="treeitem" aria-level="3" data-item="${esc(bStashKey(project, s.repoKey, s.stash.index))}">
        <div class="slot-head"><span class="name">stash@{${esc(s.stash.index)}}</span><span class="stash-msg" title="${esc(message)}">${esc(message)}</span></div>
        <div class="slot-foot"><div class="slot-sub">${[
          s.stash.branch ? `<span class="part"><span class="branch">${esc(s.stash.branch)}</span></span>` : "",
          `<span class="part">${esc(formatWhen(s.stash.at, now))}</span>`,
          `<span class="part">${esc(s.holders.join(", "))}</span>`,
        ]
          .filter(Boolean)
          .join('<span class="sep">·</span>')}</div></div>
      </li>`;
    })
    .join("");
}

/** The list column's HTML (main.ts gives the items ids and marks the selection). */
export function branchListHtml(view: BranchListView, ctx: BranchContext): string {
  return view.projects
    .map((pv) => {
      const pb = pv.pb;
      const rows = pv.collapsed
        ? ""
        : [
            repoRow(pv, ctx),
            ...pv.shown.map((g) => branchRow(pb.project, g, ctx)),
            pv.changes.length ? subHead(bChangesKey(pb.project), t("branches.changes", { n: pv.changes.length }), pv.changesCollapsed, changeRows(pb.project, pv.changes)) : "",
            pv.stashes.length ? subHead(bStashesKey(pb.project), t("branches.stashes", { n: pv.stashes.length }), pv.stashesCollapsed, stashRows(pb.project, pv.stashes, ctx.now)) : "",
          ].join("");
      return `<section class="group" role="none" data-group="${esc(pb.project)}">
        <div class="item group-head" role="treeitem" aria-level="1" aria-expanded="${!pv.collapsed}" data-item="${esc(pv.key)}">
          <div class="group-line">
            <span class="fold" data-fold aria-hidden="true">${CHEVRON}</span>
            ${projectNameHtml(pb.project, "group-name")}
            <span class="head-end">${headPills(pb)}</span>
          </div>
        </div>
        ${pv.collapsed ? "" : `<ul class="slots" role="group" aria-label="${esc(projectLabel(pb.project))}">${rows}</ul>`}
      </section>`;
    })
    .join("");
}

// ---------------------------------------------------------------- details column

function actButton(act: string, label: string, opts: { disabled?: boolean; data?: Record<string, string | number>; title?: string | null; primary?: boolean } = {}): string {
  const data = Object.entries(opts.data ?? {})
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<button type="button" class="act-btn${opts.primary ? " primary" : ""}" data-act="${act}"${data}${opts.disabled ? " disabled" : ""}${
    opts.title ? ` title="${esc(opts.title)}"` : ""
  }>${esc(label)}</button>`;
}

function slotPath(slots: readonly Slot[], name: string | null | undefined): string | null {
  return name ? (slots.find((s) => s.name === name)?.path ?? null) : null;
}

/** The view repository button: make it (asks first) or refresh it and open it in Fork. */
export function viewButton(pb: ProjectBranches, ctx: BranchContext): string {
  const action = ctx.viewAction(pb);
  const label = action.kind === "create" ? t("bv.create") : t("bv.openAll");
  return actButton("bv-run", label, { disabled: action.off !== null, title: action.off ?? t(action.kind === "create" ? "bv.createTitle" : "bv.openAllTitle"), data: { project: pb.project }, primary: action.off === null });
}

/** The view repository rows: where, when, slots, what is stale, and its buttons. */
function viewRows(pb: ProjectBranches, ctx: BranchContext): string[] {
  const v = pb.view;
  const rows: string[] = [];
  const line = viewLine(pb, ctx);
  let value = `<span class="${line.tone ? `${line.tone}-text` : ""}">${esc(line.text)}</span>`;
  if (v?.path) value = `<span class="path">${esc(v.path)}</span><br>${value}`;
  if (v) {
    const slots = (v.slots ?? []).map((s) => {
      const status = t(`bv.status.${s.status ?? "unknown"}`);
      const label = status.startsWith("bv.status.") ? (s.status ?? "?") : status;
      const changed = s.changedSince ? ` · ${t("bv.slotChanged")}` : "";
      const text = `${s.slot} ${label}${s.fetchedAt ? ` ${formatWhen(s.fetchedAt, ctx.now)}` : ""}${changed}${s.error ? ` · ${s.error}` : ""}`;
      return s.status === "failed" ? `<span class="hot-text">${esc(text)}</span>` : esc(text);
    });
    if (slots.length) value += `<br><span class="muted">${slots.join("<br>")}</span>`;
    const rejected = v.origin?.rejected ?? [];
    if (rejected.length) {
      value += `<br><span class="warn-text">${esc(t("bv.originStaleLine", { from: v.origin?.filledFrom ?? "-", names: rejected.map((r) => r.name).join(", ") }))}</span>`;
    }
  }
  value += `<div class="body-actions inline">${[
    viewButton(pb, ctx),
    v?.path ? actButton("folder", t("menu.openExplorer"), { data: { path: v.path } }) : "",
    v?.path ? actButton("copy-text", t("btn.copyPath"), { data: { text: v.path } }) : "",
  ].join("")}</div><p class="body-note">${esc(t("bv.note"))}</p>`;
  rows.push(detailRow(t("bv.label"), value));
  return rows;
}

export function projectBody(pv: ProjectView, ctx: BranchContext, filtered: boolean): string {
  const pb = pv.pb;
  const c = levelCounts(pb.groups);
  const state = t("branches.projectState", { n: pb.groups.length, critical: c.critical, warn: c.warn, info: c.info });
  const buttons = [
    viewButton(pb, ctx),
    actButton("project", t(filtered ? "group.showAll" : "group.onlyThis"), { data: { project: pb.project } }),
    actButton("cleanup-project", t("menu.cleanupScope", { scope: projectLabel(pb.project) }), { data: { project: pb.project } }),
    actButton("rename-project", t("menu.rename"), { data: { project: pb.project } }),
  ];
  const rows = [detailRow(t("branches.layout"), esc(layoutLine(pb.slots, ctx)))];
  if (projectAlias(pb.project)) rows.unshift(detailRow(t("group.realName"), esc(pb.project)));
  for (const r of pb.repos) rows.push(detailRow(r.slots.length > 1 ? repoLabel(r.repo.commonDir) : (r.slots[0]?.name ?? repoLabel(r.repo.commonDir)), repoSummary(r.repo, ctx)));
  rows.push(...viewRows(pb, ctx));
  rows.push(detailRow(t("branches.lastFull"), esc(ctx.lastFullAt ? formatWhen(ctx.lastFullAt, ctx.now) : t("detail.none"))));
  return `<div class="body-state">${esc(state)}</div>
    <div class="body-actions">${buttons.join("")}</div>
    <div class="details">${rows.join("")}</div>`;
}

function repoSummary(repo: ProjectBranches["repos"][number]["repo"], ctx: BranchContext): string {
  const bits: string[] = [`<span class="path">${esc(repo.commonDir)}</span>`];
  const n = repo.branches?.length;
  const counts = typeof n === "number" ? t("branches.repoLine", { n, stash: repo.stashes?.length ?? 0 }) : t("detail.gitFullPending");
  bits.push(`${esc(counts)}${repo.lastFetchAt ? ` <span class="muted">· ${esc(t("footer.fetch", { time: formatWhen(repo.lastFetchAt, ctx.now) }))}</span>` : ""}`);
  if (repo.error) bits.push(`<span class="hot-text">${esc(repo.error)}</span>`);
  return bits.join("<br>");
}

/** The repository row: layout, each git directory with its folders, then the view repository. */
export function repoBody(pv: ProjectView, ctx: BranchContext): string {
  const pb = pv.pb;
  const rows: string[] = [];
  for (const r of pb.repos) {
    const folders = (r.repo.folders ?? []).map((f) => {
      const at = f.detached ? t("branch.detachedAt", { sha: shortSha(f.head) }) : (f.branch ?? t("detail.none"));
      const extra = [f.locked ? t("branches.locked") : "", f.prunable ? t("branches.prunable") : ""].filter(Boolean).join(" · ");
      const fetch = pb.slots.find((s) => s.name === f.slot);
      const fetched = fetch ? ctx.gitOf(fetch)?.lastFetchAt : null;
      return `${esc(f.slot ?? t("branches.notSlot"))} <span class="branch">${esc(at)}</span>${extra ? ` <span class="warn-text">${esc(extra)}</span>` : ""}${
        fetched ? ` <span class="muted">· ${esc(t("footer.fetch", { time: formatWhen(fetched, ctx.now) }))}</span>` : ""
      }<br><span class="path muted">${esc(f.path)}</span>`;
    });
    const layout = t(`branches.layout.${r.repo.layout ?? "clone"}`);
    const counts = repoCounts(r.slots.length ? ctx.gitOf(r.slots[0]) : null);
    const pills = repoPills(counts, ctx);
    rows.push(
      detailRow(
        r.slots.length > 1 ? repoLabel(r.repo.commonDir) : (r.slots[0]?.name ?? repoLabel(r.repo.commonDir)),
        `${repoSummary(r.repo, ctx)}<br>${esc(layout.startsWith("branches.layout.") ? (r.repo.layout ?? "") : layout)}${
          r.repo.hub ? ` · <span class="path">${esc(r.repo.hub)}</span>` : ""
        }${pills.length ? ` <span class="pills inline">${pills.join("")}</span>` : ""}<br>${folders.join("<br>")}`,
      ),
    );
  }
  rows.push(...viewRows(pb, ctx));
  return `<div class="body-state">${esc(layoutLine(pb.slots, ctx))}</div>
    <div class="body-actions">${[
      pb.repos[0]?.repo.folders?.[0]?.path ? actButton("open-path", t("bv.openFirst"), { data: { path: pb.repos[0].repo.folders[0].path, target: "fork" } }) : "",
      actButton("cleanup-project", t("menu.cleanupScope", { scope: projectLabel(pb.project) }), { data: { project: pb.project } }),
    ].join("")}</div>
    <div class="details">${rows.join("")}</div>`;
}

/** Where a branch is best opened: a folder that has it checked out, else a copy with commits on no remote, else the first. */
export function branchHome(g: BranchGroup, slots: readonly Slot[]): { slot: string | null; path: string } | null {
  const out = g.copies.flatMap((c) => c.checkouts);
  if (out.length) return out[0];
  const local = g.copies.find((c) => (c.localOnly ?? 0) > 0) ?? g.copies[0];
  if (!local) return null;
  const holder = local.holders[0] ?? null;
  const path = slotPath(slots, holder);
  return path ? { slot: holder, path } : null;
}

export function branchBody(g: BranchGroup, pb: ProjectBranches, ctx: BranchContext): string {
  // The verdict says what the comparison of copies found; the reasons add each copy's own
  const verdict = verdictText(g);
  const own = g.reasons.filter((r) => !verdict || !VERDICT_REASONS.has(r)).map((r) => reasonText(r, g));
  const state = [verdict, ...own].filter((s): s is string => !!s);
  const home = branchHome(g, pb.slots);
  const buttons = [
    actButton("copy-text", t("branch.copyName"), { data: { text: g.name } }),
    home ? actButton("open-path", t("menu.open", { app: t(`open.${ctx.settings.openTarget}`) }), { data: { path: home.path, target: ctx.settings.openTarget }, title: home.slot ?? home.path }) : "",
    home && ctx.settings.openTarget !== "explorer" ? actButton("folder", t("menu.openExplorer"), { data: { path: home.path } }) : "",
    actButton("branch-cleanup", t("branch.cleanup"), { data: { project: pb.project, name: g.name } }),
  ];

  const rows: string[] = [];
  const head = `<div class="copies" role="table" aria-label="${esc(t("branch.copiesTable"))}">
    <div class="copies-row head" role="row"><span role="columnheader">${esc(t("branch.col.slot"))}</span><span role="columnheader">${esc(t("branch.col.tip"))}</span><span role="columnheader">${esc(
      t("branch.col.upstream"),
    )}</span><span role="columnheader">${esc(t("branch.col.local"))}</span><span role="columnheader">${esc(t("branch.col.checkout"))}</span></div>
    ${g.copies
      .map((c) => {
        const fetched = c.lastFetchAt ? t("footer.fetch", { time: formatWhen(c.lastFetchAt, ctx.now) }) : "";
        const up = !c.upstream
          ? "-"
          : c.upstreamGone
            ? t("branch.gone")
            : c.ahead === 0 && c.behind === 0
              ? "="
              : `${c.ahead ? `↑${c.ahead}` : ""}${c.behind ? `↓${c.behind}` : ""}` || "?";
        const co = c.checkouts.map((k) => k.slot ?? k.path).join(", ");
        return `<div class="copies-row" role="row" title="${esc(fetched)}"><span role="cell" class="mid-cell">${nameHtml(c.holders.join(", ") || repoLabel(c.commonDir), "copy-name")}</span><span role="cell" class="mono">${esc(
          shortSha(c.tip),
        )}</span><span role="cell">${esc(up)}</span><span role="cell">${esc(c.localOnly ?? "?")}</span><span role="cell">${esc(co ? t("branch.yes") : "")}</span></div>`;
      })
      .join("")}
  </div>
  <p class="body-note">${esc(t("branch.fetchNote"))}</p>`;
  const upstreams = [...new Set(g.copies.map((c) => c.upstream ?? ""))];
  rows.push(
    detailRow(
      t("branch.upstream"),
      upstreams
        .map((u) => (u ? (upstreamBranch(u) !== g.name ? `<span class="warn-text">→ ${esc(u)}</span>` : esc(u)) : esc(t("branch.noUpstream"))))
        .join("<br>"),
    ),
  );
  if (g.localOnly > 0) {
    rows.push(detailRow(t("branch.localOnly"), esc(g.localOnlyAt ? t("git.localOnlySince", { n: g.localOnly, date: formatWhen(g.localOnlyAt, ctx.now) }) : t("git.localOnly", { n: g.localOnly }))));
  }
  const subject = g.copies.find((c) => c.subject)?.subject;
  if (subject) rows.push(detailRow(t("branch.subject"), esc(subject)));
  const checkoutSlots = [...new Set(g.copies.flatMap((c) => c.checkouts.map((k) => k.slot)).filter((s): s is string => !!s))];
  if (checkoutSlots.length) {
    const work = checkoutSlots.map((name) => {
      const item = pb.changes.find((c) => c.slot.name === name);
      return `${esc(name)} ${esc(item ? changesText(item) : "0")}`;
    });
    rows.push(detailRow(t("branch.working"), work.join("<br>")));
  }
  const stashes = pb.stashes.filter((s) => s.stash.branch === g.name);
  rows.push(
    detailRow(
      t("branch.stash"),
      stashes.length
        ? `${stashes.map((s) => esc(`stash@{${s.stash.index}} ${s.stash.message ?? ""}`)).join("<br>")}<br><span class="muted">${esc(t("branch.stashGuess"))}</span>`
        : esc(t("branch.none")),
    ),
  );
  const ref = g.copies.map((c) => viewRef(pb.view, c)).find((r): r is string => !!r);
  if (ref && pb.view?.path) {
    rows.push(
      detailRow(
        t("bv.label"),
        `<span class="mono">${esc(ref)}</span><div class="body-actions inline">${actButton("copy-text", t("bv.copyRef"), { data: { text: ref } })}${actButton("open-path", t("bv.openFork"), {
          data: { path: pb.view.path, target: "fork" },
        })}</div>`,
      ),
    );
  }
  rows.push(detailRow(t("branches.lastFull"), esc(ctx.lastFullAt ? formatWhen(ctx.lastFullAt, ctx.now) : t("detail.none"))));
  return `<div class="body-state">${state.map((s) => `<span>${esc(s)}</span>`).join('<span class="sep">·</span>')}</div>
    <div class="body-actions">${buttons.join("")}</div>
    ${head}
    <div class="details">${rows.join("")}</div>`;
}

export function changeBody(item: ChangeItem, ctx: BranchContext): string {
  const rows = [
    detailRow(t("detail.path"), `<span class="path">${esc(item.slot.path)}</span>`),
    detailRow(t("branch.col.branch"), `<span class="branch">${esc(item.branch ?? t("detail.none"))}</span>`),
    detailRow(t("branch.working"), esc(changesText(item))),
  ];
  const buttons = [
    actButton("open-path", t("menu.open", { app: t(`open.${ctx.settings.openTarget}`) }), { data: { path: item.slot.path, target: ctx.settings.openTarget } }),
    ctx.settings.openTarget !== "explorer" ? actButton("folder", t("menu.openExplorer"), { data: { path: item.slot.path } }) : "",
    actButton("copy-text", t("btn.copyPath"), { data: { text: item.slot.path } }),
  ];
  return `<div class="body-state">${esc(t("branch.changesState"))}</div><div class="body-actions">${buttons.join("")}</div>
    <div class="details">${rows.join("")}</div><p class="body-note">${esc(t("branch.changesNote"))}</p>`;
}

export function stashBody(item: StashItem, pb: ProjectBranches, ctx: BranchContext): string {
  const path = slotPath(pb.slots, item.holders[0]);
  const s = item.stash;
  const rows = [
    detailRow(t("branch.message"), esc(s.message ?? "")),
    detailRow(t("branch.col.branch"), s.branch ? `<span class="branch">${esc(s.branch)}</span> <span class="muted">${esc(t("branch.stashGuess"))}</span>` : esc(t("detail.none"))),
    detailRow(t("branch.when"), esc(formatWhen(s.at, ctx.now))),
    detailRow(t("branch.col.slot"), esc(item.holders.join(", "))),
    detailRow("sha", `<span class="mono">${esc(shortSha(s.sha))}</span>`),
  ];
  const buttons = [
    path ? actButton("open-path", t("menu.open", { app: t(`open.${ctx.settings.openTarget}`) }), { data: { path, target: ctx.settings.openTarget } }) : "",
    actButton("copy-text", t("branch.copyMessage"), { data: { text: s.message ?? "" } }),
  ];
  return `<div class="body-state">stash@{${esc(s.index)}}</div><div class="body-actions">${buttons.join("")}</div><div class="details">${rows.join("")}</div>`;
}

/** The changes or stash head: its rows (pressing one selects it). */
export function subgroupBody(pv: ProjectView, kind: "changes" | "stashes", ctx: BranchContext): string {
  const project = pv.pb.project;
  const items =
    kind === "changes"
      ? pv.changes.map((c) => ({ key: bChangeKey(project, c.slot.name), text: `${c.slot.name} · ${c.branch ?? "-"} · ${changesText(c)}` }))
      : pv.stashes.map((s) => ({ key: bStashKey(project, s.repoKey, s.stash.index), text: `stash@{${s.stash.index}} ${s.stash.message ?? ""} · ${formatWhen(s.stash.at, ctx.now)}` }));
  const list = items.map((i) => `<li><button type="button" class="panel-row" data-pick-item="${esc(i.key)}"><span class="grow">${esc(i.text)}</span></button></li>`).join("");
  return `<ul class="panel-list body-list">${list}</ul>`;
}

/** The title of a branch screen item. */
export function branchItemTitle(ref: BranchRef | null): string | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "project":
      return projectLabel(ref.project);
    case "repo":
      return `${projectLabel(ref.project)} · ${t("branches.repo")}`;
    case "branch":
      return ref.name;
    case "changes":
      return t("branches.changesTitle");
    case "change":
      return ref.slot;
    case "stashes":
      return "stash";
    case "stash":
      return `stash@{${ref.index}}`;
  }
}

// ---------------------------------------------------------------- a core before 0.7.0

export function oldCoreNote(doc: Dashboard | null): string {
  return t("branches.needsCore", { version: doc?.version ?? "?" });
}

/** What every core reports: per git directory the counts (no names). */
export function oldCoreList(doc: Dashboard, project: string | null, ctx: RowContext): string {
  const html: string[] = [`<p class="list-note">${esc(oldCoreNote(doc))}</p>`];
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
      return `<li class="repo-row" title="${esc(r.dir)}">
        <div class="slot-head">${nameHtml(r.slots.length > 1 ? repoLabel(r.dir) : r.slots[0], "name")}
          <span class="head-end">${pills.length ? `<span class="pills">${pills.join("")}</span>` : ""}</span></div>
        <div class="slot-foot"><div class="slot-sub"><span class="part">${esc(
          typeof total === "number" ? t("branches.count", { n: total }) : t("detail.gitFullPending"),
        )}</span>${r.slots.length > 1 ? `<span class="sep">·</span><span class="part">${esc(r.slots.join(", "))}</span>` : ""}</div></div>
      </li>`;
    });
    html.push(`<section class="group" data-group="${esc(name)}">
      <div class="group-head static"><div class="group-line">${projectNameHtml(name, "group-name")}</div></div>
      <ul class="slots">${rows.join("")}</ul>
    </section>`);
  }
  return html.join("");
}

export function oldCoreBody(doc: Dashboard | null): string {
  return bodyMessage(oldCoreNote(doc), { hint: t("body.branchesHint") });
}
