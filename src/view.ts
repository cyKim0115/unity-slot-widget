/**
 * HTML pieces for a slot: the two-line list row, its colored numbers and the details rows of the
 * details column. Every value from the dashboard goes through `esc`. Rows keep the widget's
 * drawing: name line, state line, colored numbers without backgrounds, tinted rows for attention.
 */
import type { GitState, RepoGit, Slot, SlotEvent, WidgetSettings } from "./types";
import { formatDuration, formatGb, formatWhen, t } from "./i18n";
import { icon } from "./icons";
import { elapsedSince, isOpen, localOnlyDays, type RepoCounts, repoCounts, repoKey, repoOfSlot, slotRepoKey } from "./model";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLATFORM: Record<string, string> = {
  android: "AND",
  webgl: "WEB",
  web: "WEB",
  windows: "WIN",
  standalone: "WIN",
  ios: "IOS",
  macos: "MAC",
  linux: "LNX",
};

export function platformChip(platform: string | null | undefined): string {
  if (!platform) return "";
  const code = PLATFORM[platform.toLowerCase()] ?? platform.slice(0, 3).toUpperCase();
  return `<span class="chip" title="${esc(platform)}">${esc(code)}</span>`;
}

function shortOwner(owner: string): string {
  return owner.length > 20 ? `${owner.slice(0, 18)}…` : owner;
}

/**
 * A long name split so that it shortens in the middle: the head takes the ellipsis, the tail
 * (the clone number, `-HTML5`) stays. Short names stay whole.
 */
export function splitName(name: string): [string, string] {
  if (name.length < 16) return [name, ""];
  // The last part after - or _ when it is a word of 9 to 12 letters (ShowcaseDemo), else 8 characters
  const segment = name.length - Math.max(name.lastIndexOf("-"), name.lastIndexOf("_")) - 1;
  const tail = Math.min(Math.floor(name.length / 2), segment >= 9 && segment <= 12 ? segment : 8);
  return [name.slice(0, name.length - tail), name.slice(name.length - tail)];
}

/** A name that shortens in the middle when there is no room (CSS `.mid`); the whole name is its title. */
export function nameHtml(name: string, className = "name"): string {
  const [head, tail] = splitName(name);
  return `<span class="${className} mid" title="${esc(name)}"><span class="mid-head">${esc(head)}</span>${
    tail ? `<span class="mid-tail">${esc(tail)}</span>` : ""
  }</span>`;
}

/** A span the 1-second ticker keeps up to date. */
export function since(iso: string | null | undefined, now: Date): string {
  const ms = elapsedSince(iso, now);
  if (ms === null) return "";
  return `<span data-since="${esc(iso)}">${esc(formatDuration(ms))}</span>`;
}

/**
 * A number with an optional glyph, colored by meaning and without a background, the way the
 * Claude, GPT and Flex widgets show their values. `mark` is a glyph or an icon from icons.ts
 * (trusted HTML).
 */
export function pill(kind: string, mark: string, text: string | number, title: string): string {
  return `<span class="stat stat--${kind}" title="${esc(title)}">${mark ? `<span class="stat-mark">${mark}</span>` : ""}<span>${esc(text)}</span></span>`;
}

export interface RowContext {
  now: Date;
  settings: WidgetSettings;
  gitOf: (slot: Slot) => GitState | null;
  /** Git directories two or more slots share (model.ts `sharedRepos`), by repoKey. */
  shared: ReadonlyMap<string, Slot[]>;
  /** The core's recent events (the details column's 「최근」 row). */
  events?: readonly SlotEvent[];
  /** Core 0.7.0 git directories, the last full answer kept (model.ts mergeRepos): branch names. */
  repos?: readonly RepoGit[] | null;
}

/** The slots that share this slot's git directory, or null for a clone. */
export function sharedWith(slot: Slot, ctx: RowContext): Slot[] | null {
  const key = slotRepoKey(slot, ctx.gitOf);
  return (key && ctx.shared.get(key)) || null;
}

/** The slot's folder holds the git directory (its commonDir is `<path>/.git`). */
export function isMainFolder(slot: Slot, ctx: Pick<RowContext, "gitOf">): boolean {
  const dir = ctx.gitOf(slot)?.commonDir;
  return !!dir && repoKey(dir) === repoKey(`${slot.path}/.git`);
}

export function memoryPill(slot: Slot, ctx: RowContext): string {
  const gb = slot.editor?.memory?.totalPrivGB;
  if (typeof gb !== "number" || !isOpen(slot)) return "";
  return pill(gb >= ctx.settings.slotMemoryWarnGb ? "warn" : "plain", "", `${formatGb(gb)}G`, t("detail.memory"));
}

/** The repository's own numbers: commits on no remote (colored by age), branches without or with a gone upstream, stashes. */
export function repoPills(counts: RepoCounts | null, ctx: Pick<RowContext, "now" | "settings">): string[] {
  if (!counts) return [];
  const out: string[] = [];
  if (counts.localOnly > 0) {
    const days = localOnlyDays({ localOnly: { commits: counts.localOnly, oldestAt: counts.localOnlyOldestAt } }, ctx.now);
    const kind =
      days !== null && days >= ctx.settings.localOnlyCriticalDays
        ? "hot"
        : days !== null && days >= ctx.settings.localOnlyWarnDays
          ? "warn"
          : "local";
    const title = counts.localOnlyOldestAt
      ? t("git.localOnlySince", { n: counts.localOnly, date: formatWhen(counts.localOnlyOldestAt, ctx.now) })
      : t("git.localOnly", { n: counts.localOnly });
    out.push(pill(kind, icon("cloudOff", 11), counts.localOnly, title));
  }
  if (counts.noUpstream > 0) out.push(pill("branch", icon("branch", 11), counts.noUpstream, t("git.noUpstream", { n: counts.noUpstream })));
  if (counts.gone > 0) out.push(pill("branch", icon("unlink", 11), counts.gone, t("git.gone", { n: counts.gone })));
  if (counts.stash > 0) out.push(pill("warn", icon("archive", 11), counts.stash, t("git.stash", { n: counts.stash })));
  return out;
}

/**
 * The row's git numbers. A clone shows all of them; a slot whose git directory others share shows
 * only its folder's (changes, ahead, behind) and leaves the repository's to the group head.
 */
export function gitPills(git: GitState | null, ctx: RowContext, withRepo = true, extra: readonly string[] = []): string {
  const out: string[] = [];
  if (git) {
    const changes = git.changes ?? 0;
    if (changes > 0) out.push(pill("dirty", "●", changes, t("git.changes", { n: changes })));
    if ((git.ahead ?? 0) > 0) out.push(pill("push", "↑", git.ahead ?? 0, t("git.ahead", { n: git.ahead ?? 0 })));
    if ((git.behind ?? 0) > 0) out.push(pill("pull", "↓", git.behind ?? 0, t("git.behind", { n: git.behind ?? 0 })));
    if (withRepo) {
      // Basic answers have no repository numbers; a stash count may still come alone
      const counts = repoCounts(git) ?? (git.stash ? { localOnly: 0, localOnlyOldestAt: null, noUpstream: 0, gone: 0, stash: git.stash, total: null } : null);
      out.push(...repoPills(counts, ctx));
    }
  }
  out.push(...extra);
  return out.length ? `<span class="pills">${out.join("")}</span>` : "";
}

/** Second line: branch · state and time · lease. */
export function subLine(slot: Slot, git: GitState | null, ctx: RowContext): string {
  const editor = slot.editor;
  const state = editor?.state ?? "closed";
  const parts: string[] = [];
  if (git?.branch) parts.push(`<span class="branch" title="${esc(git.branch)}">${esc(git.branch)}</span>`);
  switch (state) {
    case "ready":
    case "unknown":
    case "starting":
    case "stalled":
      parts.push(`${esc(t(`state.${state}`))} ${since(editor?.startedAt, ctx.now)}`);
      break;
    case "closed":
      parts.push(
        slot.lastClosedAt ? esc(t("row.lastClosed", { time: formatWhen(slot.lastClosedAt, ctx.now) })) : esc(t("state.closed")),
      );
      break;
    default:
      parts.push(esc(t(`state.${state}`)));
  }
  const lease = slot.lease;
  if (lease?.owner) {
    let text = esc(t("row.lease", { owner: shortOwner(lease.owner) }));
    if (lease.expired) text += ` <span class="hot-text">${esc(t("row.leaseExpired"))}</span>`;
    else if (lease.client?.alive === false) text += ` <span class="warn-text">${esc(t("row.leaseClientGone"))}</span>`;
    else if (lease.acquiredAt) text += ` ${since(lease.acquiredAt, ctx.now)}`;
    parts.push(`<span class="lease" title="${esc(lease.owner)}${lease.need ? ` · ${esc(lease.need)}` : ""}">${text}</span>`);
  }
  // Each part is its own span: inside a flex row bare text would lose its spaces.
  return parts.map((p) => `<span class="part">${p}</span>`).join('<span class="sep">·</span>');
}

/** Row tint, like the other widgets tint a dirty or diverged repository. */
export function tint(slot: Slot): string {
  const state = slot.editor?.state ?? "closed";
  const flags = slot.flags ?? [];
  if (state === "stalled" || state === "missing" || flags.includes("lease-expired-open")) return "tint-hot";
  if (
    state === "starting" ||
    flags.includes("open-without-lease") ||
    flags.includes("unsaved-scene") ||
    flags.includes("lease-client-gone")
  )
    return "tint-warn";
  if (state === "closed") return "is-closed";
  return "";
}

export function detailRow(label: string, value: string): string {
  return `<div class="d-label">${esc(label)}</div><div class="d-value">${value}</div>`;
}

/** The slot's recent events, newest first: 「11:02 준비됨 · 10:50 임대 claude:93cc」. */
export function slotEvents(slot: Slot, events: readonly SlotEvent[] | undefined, now: Date, max = 3): string {
  const mine = (events ?? [])
    .filter((e) => e.slot === slot.name)
    .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
    .slice(0, max);
  return mine
    .map((e) => {
      const name = t(`event.${e.event}`);
      const what = name.startsWith("event.") ? e.event : name;
      return [formatWhen(e.time, now), what, e.owner ?? ""].filter(Boolean).join(" ");
    })
    .join(" · ");
}

const NAMES_SHOWN = 8;

/** The branch names of the slot's git directory (core 0.7.0, last full answer): its own first, marked. */
function branchNames(slot: Slot, git: GitState, ctx: RowContext): string | null {
  const list = repoOfSlot(slot, ctx.repos, ctx.gitOf)?.branches;
  if (!list?.length) return null;
  const mine = git.branch;
  const names = [...list.filter((b) => b.name === mine), ...list.filter((b) => b.name !== mine)].map((b) => (b.name === mine ? `${b.name} *` : b.name));
  const more = names.length - NAMES_SHOWN;
  return more > 0 ? t("detail.branchNamesMore", { list: names.slice(0, NAMES_SHOWN).join(", "), n: more }) : names.join(", ");
}

/** The checked-out branch's own commits on no remote, for a slot whose repository numbers sit on the group head. */
function currentBranchPill(slot: Slot, git: GitState | null, ctx: RowContext): string[] {
  const branch = repoOfSlot(slot, ctx.repos, ctx.gitOf)?.branches?.find((b) => b.name === git?.branch);
  const n = branch?.localOnly?.commits ?? 0;
  if (!branch || n <= 0) return [];
  const days = localOnlyDays({ localOnly: branch.localOnly }, ctx.now);
  const kind = days !== null && days >= ctx.settings.localOnlyCriticalDays ? "hot" : days !== null && days >= ctx.settings.localOnlyWarnDays ? "warn" : "local";
  return [pill(kind, icon("cloudOff", 11), n, t("git.branchLocalOnly", { n, branch: branch.name }))];
}

/** The git rows: the folder (branch, changes, ↑↓, fetch) and the branches of its repository. */
function gitRows(slot: Slot, ctx: RowContext): string[] {
  const none = t("detail.none");
  const g = ctx.gitOf(slot);
  if (!g) return [];
  const rows: string[] = [];
  let value = esc(t("detail.gitLine", { branch: g.branch ?? none, changes: g.changes ?? 0, ahead: g.ahead ?? 0, behind: g.behind ?? 0 }));
  if (g.lastFetchAt) value += ` <span class="muted">· ${esc(t("footer.fetch", { time: formatWhen(g.lastFetchAt, ctx.now) }))}</span>`;
  if (g.error) value += `<br><span class="hot-text">${esc(g.error)}</span>`;
  rows.push(detailRow(t("detail.git"), value));

  const counts = repoCounts(g);
  const shared = sharedWith(slot, ctx);
  let branches: string;
  if (counts) {
    const params = {
      total: counts.total ?? none,
      localOnly: counts.localOnly,
      noUpstream: counts.noUpstream,
      gone: counts.gone,
      stash: counts.stash,
    };
    branches = esc(shared ? t("detail.branchLineShared", { ...params, n: shared.length }) : t("detail.branchLine", params));
    const others = (g.worktrees ?? []).map((w) => (typeof w === "string" ? w : w.branch ? `${w.path} (${w.branch})` : w.path));
    if (others.length) branches += `<br>${esc(t("detail.worktrees", { list: others.join(", ") }))}`;
  } else {
    branches = `<span class="muted">${esc(t("detail.gitFullPending"))}</span>`;
  }
  const names = branchNames(slot, g, ctx);
  if (names) branches += `<br><span class="branch-names">${esc(names)}</span>`;
  branches += `<br><button type="button" class="link-btn" data-act="branches">${esc(t("detail.showBranches"))}</button>`;
  rows.push(detailRow(t("detail.branches"), branches));
  return rows;
}

/** The details column's rows for a slot. */
export function details(slot: Slot, ctx: RowContext): string {
  const none = t("detail.none");
  const e = slot.editor;
  const rows: string[] = [];
  const missing = slot.exists === false || e?.state === "missing";
  rows.push(
    detailRow(t("detail.path"), `<span class="path${missing ? " hot-text" : ""}" title="${esc(slot.path)}">${esc(slot.path)}</span>`),
  );
  const unityBits = [slot.unity ?? none];
  if (e?.launch) unityBits.push(e.launch);
  if (e?.standby) unityBits.push(`standby ${e.standby}`);
  if (e?.lock && e.lock !== "none") unityBits.push(t("detail.lock", { lock: e.lock }));
  if (e?.unsavedScene) unityBits.push(t("detail.unsaved"));
  rows.push(detailRow(t("detail.unity"), esc(unityBits.join(" · "))));
  if (e?.readyAt) {
    rows.push(
      detailRow(
        t("detail.ready"),
        esc(t("detail.readyLine", { time: formatWhen(e.readyAt, ctx.now), secs: e.readySeconds?.toFixed(1) ?? none })),
      ),
    );
  } else if (e?.startedAt && isOpen(slot)) {
    rows.push(detailRow(t("detail.ready"), esc(t("detail.startedLine", { time: formatWhen(e.startedAt, ctx.now) }))));
  }
  const m = e?.memory;
  if (m && isOpen(slot)) {
    const warn = typeof m.totalPrivGB === "number" && m.totalPrivGB >= ctx.settings.slotMemoryWarnGb;
    const line = esc(
      t("detail.memoryLine", {
        editor: formatGb(m.editorPrivGB),
        workers: formatGb(m.workersPrivGB),
        wn: m.workers ?? 0,
        children: formatGb(m.childrenPrivGB),
        cn: m.children ?? 0,
        total: formatGb(m.totalPrivGB),
        ws: formatGb(m.totalWsGB),
      }),
    );
    rows.push(detailRow(t("detail.memory"), warn ? `<span class="warn-text">${line}</span>` : line));
  }
  const l = slot.lease;
  if (l?.owner) {
    let value = esc(
      t("detail.leaseLine", {
        owner: l.owner,
        need: l.need || none,
        from: formatWhen(l.acquiredAt, ctx.now),
        until: formatWhen(l.expiresAt, ctx.now),
      }),
    );
    if (l.expired) value = `<span class="hot-text">${value} · ${esc(t("row.leaseExpired"))}</span>`;
    // The agent client that took the lease (MCP leases only, core 0.5.5+).
    if (l.client) {
      const gone = l.client.alive === false;
      const line = esc(
        t("detail.leaseClient", {
          name: l.client.name ?? none,
          pid: l.client.pid ?? none,
          state: t(gone ? "detail.clientGone" : "detail.clientAlive"),
        }),
      );
      value += `<br>${gone ? `<span class="warn-text">${line}</span>` : line}`;
    }
    rows.push(detailRow(t("detail.lease"), value));
  } else if ((slot.flags ?? []).includes("open-without-lease")) {
    rows.push(detailRow(t("detail.lease"), `<span class="warn-text">${esc(t("detail.noLease"))}</span>`));
  }
  rows.push(...gitRows(slot, ctx));
  const recent: string[] = [];
  if (slot.lastOpenedAt || slot.lastClosedAt) {
    recent.push(esc(t("detail.recentLine", { open: formatWhen(slot.lastOpenedAt, ctx.now), close: formatWhen(slot.lastClosedAt, ctx.now) })));
  }
  const events = slotEvents(slot, ctx.events, ctx.now);
  if (events) recent.push(`<span class="muted">${esc(events)}</span>`);
  if (recent.length) rows.push(detailRow(t("detail.recent"), recent.join("<br>")));
  if (slot.purposes?.length) rows.push(detailRow(t("detail.purposes"), esc(slot.purposes.join(", "))));
  if (slot.memo) rows.push(detailRow(t("detail.memo"), esc(slot.memo)));
  return `<div class="details">${rows.join("")}</div>`;
}

/**
 * A two-line list row (a tree item; main.ts sets ids and the selection). Line 1: state dot, name
 * shortened in the middle, platform, tags, memory. Line 2: branch · state and time · lease, then
 * the git numbers, which drop under it when the row is narrow.
 */
export function row(slot: Slot, ctx: RowContext, key: string): string {
  const state = slot.editor?.state ?? "closed";
  const git = ctx.gitOf(slot);
  const shared = sharedWith(slot, ctx);
  const tags: string[] = [];
  if (slot.mode === "hot") tags.push(t("mode.hot"));
  if (slot.agentUse === false) tags.push(t("row.userOnly"));
  // In a repository several slots share, the folder that holds the git directory is the main one
  if (shared && isMainFolder(slot, ctx)) tags.push(t("row.mainFolder"));
  else if (slot.kind === "worktree" || shared) tags.push(t("row.worktree"));
  return `<li class="item slot state-${esc(state)} ${tint(slot)}" role="treeitem" aria-level="2" data-item="${esc(key)}" data-slot="${esc(slot.name)}" title="${esc(t(`state.${state}`))}">
    <div class="slot-head">
      <span class="dot" aria-hidden="true"></span>
      ${nameHtml(slot.name)}
      ${platformChip(slot.platform)}
      ${tags.length ? `<span class="tags">${tags.map(esc).join(" · ")}</span>` : ""}
      <span class="head-end">${memoryPill(slot, ctx)}</span>
    </div>
    <div class="slot-foot">
      <div class="slot-sub">${subLine(slot, git, ctx)}</div>
      ${gitPills(git, ctx, !shared, shared ? currentBranchPill(slot, git, ctx) : [])}
    </div>
  </li>`;
}

/** The details column's centered message (loading, errors, nothing selected). */
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
