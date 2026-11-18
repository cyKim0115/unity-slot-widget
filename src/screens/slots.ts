/**
 * The slot screen: the list column (project groups of two-line slot rows, then editors and workers
 * that are no slot) and what the details column shows for each kind of item. Pure HTML builders;
 * main.ts owns the state (selection, filters, folded groups) and the events.
 *
 * Items carry a key in `data-item`: `g:<project>` group head, `s:<slot>` slot row, `x:extra` the
 * group of editors and workers outside the registry, `e:<pid>` / `w:<pid>` one of those. The list
 * is a tree (role tree / treeitem with aria-level): ↑↓ Home End move over the items on screen,
 * Enter and ←/→ fold a group (main.ts).
 *
 * Numbers that belong to a git directory several slots share (worktree slots: commits on no remote,
 * branches without upstream or with a gone one, stashes) are drawn once, on the group head; a clone
 * keeps them on its row. This works with cores before 0.7.0 too (`git.commonDir`).
 */
import type { Dashboard, OrphanWorker, Slot, UnregisteredEditor } from "../types";
import { formatGb, formatWhen, t } from "../i18n";
import { projectAlias, projectLabel, projectMatches } from "../aliases";
import { fetchRange, groupName, isOpen, layoutCounts, projectGroups, repoCounts, type RepoCounts, repoKey } from "../model";
import {
  bodyMessage,
  details,
  detailRow,
  esc,
  nameHtml,
  pill,
  platformChip,
  projectNameHtml,
  repoPills,
  row,
  since,
  type RowContext,
} from "../view";

export type SlotFilter = "all" | "open" | "attention";
export const SLOT_FILTERS: readonly SlotFilter[] = ["all", "open", "attention"];

export const EXTRA_KEY = "x:extra";
export const slotKey = (name: string): string => `s:${name}`;
export const groupKey = (name: string): string => `g:${name}`;
export const editorKey = (pid: number): string => `e:${pid}`;
export const workerKey = (pid: number): string => `w:${pid}`;

export type ItemRef =
  | { kind: "slot"; name: string }
  | { kind: "group"; name: string }
  | { kind: "extra" }
  | { kind: "editor"; pid: number }
  | { kind: "worker"; pid: number };

/** The item a key names. A selection saved by an older version is a bare slot name. */
export function parseKey(key: string | null | undefined): ItemRef | null {
  if (!key) return null;
  const m = /^([sgxew]):(.*)$/s.exec(key);
  if (!m) return { kind: "slot", name: key };
  const [, kind, rest] = m;
  switch (kind) {
    case "s":
      return { kind: "slot", name: rest };
    case "g":
      return { kind: "group", name: rest };
    case "x":
      return { kind: "extra" };
    default: {
      const pid = Number(rest);
      if (!Number.isInteger(pid)) return null;
      return kind === "e" ? { kind: "editor", pid } : { kind: "worker", pid };
    }
  }
}

export interface ListState {
  filter: SlotFilter;
  /** One project (group name), or null for all. */
  project: string | null;
  find: string;
  /** Folded groups by key (EXTRA_KEY included). While finding, every group is open. */
  collapsed: ReadonlySet<string>;
  /** Slots with a critical or attention warning (the 「주의」 filter). */
  warned: ReadonlySet<string>;
}

export interface RepoBlock {
  key: string;
  /** The git directory as the core wrote it. */
  dir: string;
  slots: Slot[];
  counts: RepoCounts | null;
}

export interface GroupView {
  name: string;
  key: string;
  /** Every slot of the project (the open count is over these). */
  members: Slot[];
  /** The ones the filter and the find text let through, open first. */
  shown: Slot[];
  collapsed: boolean;
  /** Git directories two or more of its slots share. */
  repos: RepoBlock[];
}

export interface ExtraView {
  editors: UnregisteredEditor[];
  workers: OrphanWorker[];
  collapsed: boolean;
}

export interface SlotListView {
  groups: GroupView[];
  extra: ExtraView | null;
  /** The keys of the items on screen, in order (keyboard moves). */
  keys: string[];
}

function matchesFind(slot: Slot, text: string, ctx: RowContext): boolean {
  if (!text) return true;
  const git = ctx.gitOf(slot);
  return [slot.name, slot.path, slot.project, slot.repo, git?.branch, slot.lease?.owner, slot.memo, slot.platform]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(text));
}

function repoBlocks(members: Slot[], ctx: RowContext): RepoBlock[] {
  const blocks = new Map<string, RepoBlock>();
  for (const s of members) {
    const git = ctx.gitOf(s);
    const dir = git?.commonDir;
    if (!dir) continue;
    const key = repoKey(dir);
    const all = ctx.shared.get(key);
    if (!all) continue;
    if (!blocks.has(key)) blocks.set(key, { key, dir, slots: all, counts: null });
    const block = blocks.get(key)!;
    // The core copies the same numbers to each slot of the repository: the first full answer will do
    block.counts ??= repoCounts(git);
  }
  return [...blocks.values()];
}

/** What the list shows for the document, the screen state and the find text. */
export function buildSlotList(doc: Dashboard, state: ListState, ctx: RowContext): SlotListView {
  const text = state.find.trim().toLowerCase();
  const finding = text !== "";
  const groups: GroupView[] = [];
  const keys: string[] = [];
  for (const [name, members] of projectGroups(doc.slots ?? [])) {
    if (state.project !== null && name !== state.project) continue;
    const groupHit = finding && projectMatches(name, text);
    const shown = members.filter((s) => {
      if (state.filter === "open" && !isOpen(s)) return false;
      if (state.filter === "attention" && !state.warned.has(s.name)) return false;
      return groupHit || matchesFind(s, text, ctx);
    });
    if (!shown.length) continue;
    const key = groupKey(name);
    const collapsed = !finding && state.collapsed.has(key);
    groups.push({ name, key, members, shown: [...shown.filter(isOpen), ...shown.filter((s) => !isOpen(s))], collapsed, repos: repoBlocks(members, ctx) });
  }
  for (const g of groups) {
    keys.push(g.key);
    if (!g.collapsed) keys.push(...g.shown.map((s) => slotKey(s.name)));
  }

  // Editors and workers outside the registry: open editors, information only; not in a project
  let extra: ExtraView | null = null;
  if (state.project === null && state.filter !== "attention") {
    const hit = (pid: number, ...values: (string | null | undefined)[]) =>
      !finding || String(pid).includes(text) || values.some((v) => typeof v === "string" && v.toLowerCase().includes(text));
    const editors = (doc.unregisteredEditors ?? []).filter((e) => hit(e.pid, e.project));
    const workers = (doc.orphanWorkers ?? []).filter((w) => hit(w.pid, w.project));
    if (editors.length || workers.length) {
      extra = { editors, workers, collapsed: !finding && state.collapsed.has(EXTRA_KEY) };
      keys.push(EXTRA_KEY);
      if (!extra.collapsed) keys.push(...editors.map((e) => editorKey(e.pid)), ...workers.map((w) => workerKey(w.pid)));
    }
  }
  return { groups, extra, keys };
}

const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>';

/** The parent folder of a git directory (`C:\x\MyGame\.git` → MyGame), to name a shared repository. */
export function repoLabel(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? dir;
  return last.toLowerCase() === ".git" && parts.length > 1 ? parts[parts.length - 2] : last.replace(/\.git$/i, "");
}

function groupHead(g: GroupView, ctx: RowContext): string {
  const open = g.members.filter(isOpen).length;
  const lines = g.repos
    .map((r) => {
      const pills = repoPills(r.counts, ctx);
      return `<div class="repo-line" title="${esc(r.dir)}"><span class="repo-label">${esc(
        t("group.repo", { name: repoLabel(r.dir), n: r.slots.length }),
      )}</span>${pills.length ? `<span class="pills">${pills.join("")}</span>` : ""}</div>`;
    })
    .join("");
  return `<div class="item group-head" role="treeitem" aria-level="1" aria-expanded="${!g.collapsed}" data-item="${esc(g.key)}" aria-label="${esc(
    `${projectLabel(g.name)} ${t("row.openCount", { open, total: g.members.length })}`,
  )}">
    <div class="group-line">
      <span class="fold" data-fold aria-hidden="true">${CHEVRON}</span>
      ${projectNameHtml(g.name, "group-name")}
      <span class="head-end">${pill("plain", "", `${open}/${g.members.length}`, t("row.openCount", { open, total: g.members.length }))}</span>
    </div>
    ${lines}
  </div>`;
}

function extraRows(extra: ExtraView, now: Date): string {
  const editors = extra.editors.map(
    (e) => `<li class="item extra-row" role="treeitem" aria-level="2" data-item="${esc(editorKey(e.pid))}">
      <div class="slot-head"><span class="dot extra-dot" aria-hidden="true"></span><span class="name">${esc(t("extra.editor", { pid: e.pid }))}</span>
        <span class="head-end">${typeof e.memory?.totalPrivGB === "number" ? pill("plain", "", `${formatGb(e.memory.totalPrivGB)}G`, t("detail.memory")) : ""}</span></div>
      <div class="slot-foot"><div class="slot-sub"><span class="part path-part" title="${esc(e.project ?? "")}">${esc(e.project ?? t("detail.none"))}</span>${
        e.startedAt ? `<span class="sep">·</span><span class="part">${esc(formatWhen(e.startedAt, now))}</span>` : ""
      }</div></div>
    </li>`,
  );
  const workers = extra.workers.map(
    (w) => `<li class="item extra-row" role="treeitem" aria-level="2" data-item="${esc(workerKey(w.pid))}">
      <div class="slot-head"><span class="dot extra-dot" aria-hidden="true"></span><span class="name">${esc(t("extra.worker", { pid: w.pid }))}</span>
        <span class="head-end">${typeof w.privGB === "number" ? pill("plain", "", `${formatGb(w.privGB)}G`, t("detail.memory")) : ""}</span></div>
      <div class="slot-foot"><div class="slot-sub"><span class="part path-part" title="${esc(w.project ?? "")}">${esc(w.project ?? t("detail.none"))}</span></div></div>
    </li>`,
  );
  return [...editors, ...workers].join("");
}

export function extraTitle(editors: number, workers: number): string {
  return [t("footer.unregistered", { n: editors }), t("footer.orphans", { n: workers })].join(" · ");
}

/** The list column's HTML (main.ts gives the items ids and marks the selection). */
export function slotListHtml(view: SlotListView, ctx: RowContext): string {
  const html = view.groups.map(
    (g) => `<section class="group" role="none" data-group="${esc(g.name)}">
      ${groupHead(g, ctx)}
      ${g.collapsed ? "" : `<ul class="slots" role="group" aria-label="${esc(projectLabel(g.name))}">${g.shown.map((s) => row(s, ctx, slotKey(s.name))).join("")}</ul>`}
    </section>`,
  );
  const x = view.extra;
  if (x) {
    const title = extraTitle(x.editors.length, x.workers.length);
    html.push(`<section class="group extra" role="none" data-group="${esc(EXTRA_KEY)}">
      <div class="item group-head" role="treeitem" aria-level="1" aria-expanded="${!x.collapsed}" data-item="${EXTRA_KEY}" aria-label="${esc(title)}">
        <div class="group-line"><span class="fold" data-fold aria-hidden="true">${CHEVRON}</span><span class="group-name">${esc(title)}</span></div>
      </div>
      ${x.collapsed ? "" : `<ul class="slots" role="group" aria-label="${esc(title)}">${extraRows(x, ctx.now)}</ul>`}
    </section>`);
  }
  return html.join("");
}

// ---------------------------------------------------------------- details column

export type UnityButton = { kind: "open" } | { kind: "focus" } | { kind: "off"; reason: string };

/** Release stale lease (core `release -Stale`): off with a reason, or on (`off: null`). */
export type StaleLeaseButton = { off: string | null };

function actButton(act: string, label: string, opts: { disabled?: boolean; data?: Record<string, string | number>; title?: string } = {}): string {
  const data = Object.entries(opts.data ?? {})
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<button type="button" class="act-btn" data-act="${act}"${data}${opts.disabled ? " disabled" : ""}${
    opts.title ? ` title="${esc(opts.title)}"` : ""
  }>${esc(label)}</button>`;
}

/** A slot: state line, the action buttons, then the details rows. */
export function slotBody(slot: Slot, ctx: RowContext, unity: UnityButton, openTarget: string, stale: StaleLeaseButton | null = null): string {
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
    actButton("unity", unityLabel, { disabled: unity.kind === "off" }),
    stale ? actButton("release-stale", t("menu.releaseStale"), { disabled: stale.off !== null, title: stale.off ?? `unity-slot release ${slot.name} -Stale` }) : "",
    actButton("open", t("menu.open", { app: t(`open.${openTarget}`) })),
    openTarget === "explorer" ? "" : actButton("explorer", t("menu.openExplorer")),
    actButton("log", t("btn.log")),
    actButton("copy", t("btn.copyPath")),
  ];
  return `<div class="body-state">${head.join('<span class="sep">·</span>')}</div>
    <div class="body-actions">${buttons.join("")}</div>
    ${details(slot, ctx)}`;
}

function fetchText(slots: Slot[], ctx: RowContext): string | null {
  const range = fetchRange(slots, ctx.gitOf);
  if (!range) return null;
  const oldest = formatWhen(range.oldest, ctx.now);
  const newest = formatWhen(range.newest, ctx.now);
  return oldest === newest ? t("footer.fetch", { time: oldest }) : t("group.fetchRange", { from: oldest, to: newest });
}

/** One line under a project: 「클론 7 · fetch 11-05~11-16」 (the projects panel and the group body). */
export function layoutLine(slots: Slot[], ctx: RowContext): string {
  const { clones, worktrees } = layoutCounts(slots, ctx.gitOf);
  const parts: string[] = [];
  if (clones) parts.push(t("group.clones", { n: clones }));
  if (worktrees) parts.push(t("group.worktrees", { n: worktrees }));
  const fetch = fetchText(slots, ctx);
  if (fetch) parts.push(fetch);
  return parts.join(" · ");
}

/** A project group: counts, its shared repositories, its slots (pressing one selects it). */
export function groupBody(g: GroupView, ctx: RowContext, filtered: boolean): string {
  const open = g.members.filter(isOpen).length;
  const state = [t("row.openCount", { open, total: g.members.length }), layoutLine(g.members, ctx)].filter(Boolean).join(" · ");
  const buttons = [
    actButton("project", t(filtered ? "group.showAll" : "group.onlyThis"), { data: { project: g.name } }),
    actButton("cleanup-project", t("menu.cleanupScope", { scope: projectLabel(g.name) }), { data: { project: g.name } }),
    actButton("rename-project", t("menu.rename"), { data: { project: g.name } }),
  ];
  const rows: string[] = [];
  if (projectAlias(g.name)) rows.push(detailRow(t("group.realName"), esc(g.name)));
  for (const r of g.repos) {
    const counts = r.counts;
    const value = counts
      ? esc(
          t("detail.branchLineShared", {
            n: r.slots.length,
            total: counts.total ?? t("detail.none"),
            localOnly: counts.localOnly,
            noUpstream: counts.noUpstream,
            gone: counts.gone,
            stash: counts.stash,
          }),
        )
      : `<span class="muted">${esc(t("detail.gitFullPending"))}</span>`;
    rows.push(detailRow(repoLabel(r.dir), `<span class="path">${esc(r.dir)}</span><br>${value}`));
  }
  const list = g.members
    .map((s) => {
      const st = s.editor?.state ?? "closed";
      return `<li><button type="button" class="panel-row" data-pick="${esc(s.name)}">
        <span class="state-${esc(st)}"><span class="dot" aria-hidden="true"></span></span>
        ${nameHtml(s.name, "grow")}<span class="side">${esc(t(`state.${st}`))}</span>
      </button></li>`;
    })
    .join("");
  return `<div class="body-state">${esc(state)}</div>
    <div class="body-actions">${buttons.join("")}</div>
    ${rows.length ? `<div class="details">${rows.join("")}</div>` : ""}
    <h3 class="body-sub">${esc(t("group.slots"))}</h3>
    <ul class="panel-list body-list">${list}</ul>`;
}

/** The group of editors and workers outside the registry, or one of them. */
export function extraBody(doc: Dashboard, ref: ItemRef, ctx: RowContext): string {
  const note = `<p class="body-note">${esc(t("extra.note"))}</p>`;
  const none = t("detail.none");
  if (ref.kind === "editor") {
    const e = (doc.unregisteredEditors ?? []).find((x) => x.pid === ref.pid);
    if (!e) return bodyMessage(t("body.gone"));
    const rows = [
      detailRow(t("detail.path"), `<span class="path">${esc(e.project ?? none)}</span>`),
      detailRow(t("detail.pid"), esc(e.pid)),
      detailRow(t("detail.ready"), esc(t("detail.startedLine", { time: formatWhen(e.startedAt, ctx.now) }))),
      detailRow(t("detail.memory"), esc(`${formatGb(e.memory?.totalPrivGB)} GB`)),
    ];
    if (e.launch) rows.push(detailRow(t("detail.unity"), esc(e.launch)));
    const buttons = [
      actButton("focus-pid", t("menu.focusUnity"), { data: { pid: e.pid } }),
      e.project ? actButton("folder", t("menu.openExplorer"), { data: { path: e.project } }) : "",
      e.project ? actButton("copy-text", t("btn.copyPath"), { data: { text: e.project } }) : "",
    ];
    return `<div class="body-state">${esc(t("extra.editorState"))}</div><div class="body-actions">${buttons.join("")}</div>
      <div class="details">${rows.join("")}</div>${note}`;
  }
  if (ref.kind === "worker") {
    const w = (doc.orphanWorkers ?? []).find((x) => x.pid === ref.pid);
    if (!w) return bodyMessage(t("body.gone"));
    const rows = [
      detailRow(t("detail.path"), `<span class="path">${esc(w.project ?? none)}</span>`),
      detailRow(t("detail.pid"), esc(w.pid)),
      detailRow(t("detail.owner"), esc(w.ownerPid ?? none)),
      detailRow(t("detail.memory"), esc(`${formatGb(w.privGB)} GB`)),
    ];
    const buttons = [w.project ? actButton("folder", t("menu.openExplorer"), { data: { path: w.project } }) : ""];
    return `<div class="body-state">${esc(t("extra.workerState"))}</div>${buttons.join("") ? `<div class="body-actions">${buttons.join("")}</div>` : ""}
      <div class="details">${rows.join("")}</div>${note}`;
  }
  const editors = (doc.unregisteredEditors ?? []).map(
    (e) => `<li><button type="button" class="panel-row" data-pick-item="${esc(editorKey(e.pid))}"><span class="grow">${esc(
      t("extra.editorLine", { pid: e.pid, project: e.project ?? none, gb: formatGb(e.memory?.totalPrivGB), time: formatWhen(e.startedAt, ctx.now) }),
    )}</span></button></li>`,
  );
  const workers = (doc.orphanWorkers ?? []).map(
    (w) => `<li><button type="button" class="panel-row" data-pick-item="${esc(workerKey(w.pid))}"><span class="grow">${esc(
      t("extra.workerLine", { pid: w.pid, owner: w.ownerPid ?? none, project: w.project ?? none, gb: formatGb(w.privGB) }),
    )}</span></button></li>`,
  );
  return `${note}<ul class="panel-list body-list">${[...editors, ...workers].join("")}</ul>`;
}

/** The project a selection belongs to (for the group of a slot, or the group itself). */
export function projectOf(ref: ItemRef | null, doc: Dashboard | null): string | null {
  if (!ref || !doc) return null;
  if (ref.kind === "group") return ref.name;
  if (ref.kind === "slot") {
    const slot = (doc.slots ?? []).find((s) => s.name === ref.name);
    return slot ? groupName(slot) : null;
  }
  return null;
}
