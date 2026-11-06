/**
 * HTML for the widget body. Every value from the dashboard goes through `esc`.
 * The look follows the author's other widgets (Repo Multi-Check, Claude Usage, ...):
 * uppercase captions, card rows, round pills, and the same graphite colors with a blue accent.
 */
import type { Dashboard, GitState, Slot, SlotEvent, WidgetSettings } from "./types";
import { formatDuration, formatGb, formatWhen, t } from "./i18n";
import { icon } from "./icons";
import { elapsedSince, isOpen, localOnlyDays, type Warning } from "./model";

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

function platformChip(platform: string | null | undefined): string {
  if (!platform) return "";
  const code = PLATFORM[platform.toLowerCase()] ?? platform.slice(0, 3).toUpperCase();
  return `<span class="chip" title="${esc(platform)}">${esc(code)}</span>`;
}

function shortOwner(owner: string): string {
  return owner.length > 20 ? `${owner.slice(0, 18)}…` : owner;
}

/** A span the 1-second ticker keeps up to date. */
function since(iso: string | null | undefined, now: Date): string {
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
  expanded: Set<string>;
  gitOf: (slot: Slot) => GitState | null;
}

function memoryPill(slot: Slot, ctx: RowContext): string {
  const gb = slot.editor?.memory?.totalPrivGB;
  if (typeof gb !== "number" || !isOpen(slot)) return "";
  return pill(gb >= ctx.settings.slotMemoryWarnGb ? "warn" : "plain", "", `${formatGb(gb)}G`, t("detail.memory"));
}

function gitPills(git: GitState | null, ctx: RowContext): string {
  const out: string[] = [];
  if (git) {
    const changes = git.changes ?? 0;
    if (changes > 0) out.push(pill("dirty", "●", changes, t("git.changes", { n: changes })));
    if ((git.ahead ?? 0) > 0) out.push(pill("push", "↑", git.ahead ?? 0, t("git.ahead", { n: git.ahead ?? 0 })));
    if ((git.behind ?? 0) > 0) out.push(pill("pull", "↓", git.behind ?? 0, t("git.behind", { n: git.behind ?? 0 })));
    const local = git.localOnly?.commits ?? 0;
    if (local > 0) {
      const days = localOnlyDays(git, ctx.now);
      const kind =
        days !== null && days >= ctx.settings.localOnlyCriticalDays
          ? "hot"
          : days !== null && days >= ctx.settings.localOnlyWarnDays
            ? "warn"
            : "local";
      const title = git.localOnly?.oldestAt
        ? t("git.localOnlySince", { n: local, date: formatWhen(git.localOnly.oldestAt, ctx.now) })
        : t("git.localOnly", { n: local });
      out.push(pill(kind, icon("cloudOff", 11), local, title));
    }
    const noUp = git.branches?.noUpstream ?? 0;
    if (noUp > 0) out.push(pill("branch", icon("branch", 11), noUp, t("git.noUpstream", { n: noUp })));
    const gone = git.branches?.upstreamGone ?? 0;
    if (gone > 0) out.push(pill("branch", icon("unlink", 11), gone, t("git.gone", { n: gone })));
    const stash = git.stash ?? 0;
    if (stash > 0) out.push(pill("warn", icon("archive", 11), stash, t("git.stash", { n: stash })));
  }
  return out.length ? `<span class="pills">${out.join("")}</span>` : "";
}

/** Second line: branch · state and time · lease. */
function subLine(slot: Slot, git: GitState | null, ctx: RowContext): string {
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

/** Card tint, like the other widgets tint a dirty or diverged repository. */
function tint(slot: Slot): string {
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

function detailRow(label: string, value: string): string {
  return `<div class="d-label">${esc(label)}</div><div class="d-value">${value}</div>`;
}

function details(slot: Slot, ctx: RowContext): string {
  const none = t("detail.none");
  const e = slot.editor;
  const rows: string[] = [];
  rows.push(
    detailRow(
      t("detail.path"),
      `<span class="path" title="${esc(slot.path)}">${esc(slot.path)}</span>
       <span class="d-actions">
         <button class="mini" data-action="folder" data-path="${esc(slot.path)}" title="${esc(t("btn.folder"))}">${icon("folder", 13)}</button>
         <button class="mini" data-action="log" data-path="${esc(slot.path)}" title="${esc(t("btn.log"))}">${icon("log", 13)}</button>
         <button class="mini" data-action="copy" data-path="${esc(slot.path)}" title="${esc(t("btn.copyPath"))}">${icon("copy", 13)}</button>
       </span>`,
    ),
  );
  const unityBits = [slot.unity ?? none];
  if (e?.launch) unityBits.push(e.launch);
  if (e?.standby) unityBits.push(`standby ${e.standby}`);
  if (e?.lock && e.lock !== "none") unityBits.push(t("detail.lock", { lock: e.lock }));
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
    rows.push(
      detailRow(
        t("detail.memory"),
        esc(
          t("detail.memoryLine", {
            editor: formatGb(m.editorPrivGB),
            workers: formatGb(m.workersPrivGB),
            wn: m.workers ?? 0,
            children: formatGb(m.childrenPrivGB),
            cn: m.children ?? 0,
            total: formatGb(m.totalPrivGB),
            ws: formatGb(m.totalWsGB),
          }),
        ),
      ),
    );
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
  }
  const g = ctx.gitOf(slot);
  if (g) {
    let value = esc(
      t("detail.gitLine", { branch: g.branch ?? none, changes: g.changes ?? 0, ahead: g.ahead ?? 0, behind: g.behind ?? 0 }),
    );
    if (g.level === "full") {
      value += `<br>${esc(
        t("detail.gitFullLine", {
          localOnly: g.localOnly?.commits ?? 0,
          total: g.branches?.total ?? none,
          noUpstream: g.branches?.noUpstream ?? 0,
          gone: g.branches?.upstreamGone ?? 0,
          stash: g.stash ?? 0,
        }),
      )}`;
      const others = (g.worktrees ?? []).map((w) =>
        typeof w === "string" ? w : w.branch ? `${w.path} (${w.branch})` : w.path,
      );
      if (others.length) value += `<br>${esc(t("detail.worktrees", { list: others.join(", ") }))}`;
    } else {
      value += `<br><span class="muted">${esc(t("detail.gitFullPending"))}</span>`;
    }
    if (g.error) value += `<br><span class="hot-text">${esc(g.error)}</span>`;
    rows.push(detailRow(t("detail.git"), value));
  }
  if (slot.lastOpenedAt || slot.lastClosedAt) {
    rows.push(
      detailRow(
        t("detail.recent"),
        esc(t("detail.recentLine", { open: formatWhen(slot.lastOpenedAt, ctx.now), close: formatWhen(slot.lastClosedAt, ctx.now) })),
      ),
    );
  }
  if (slot.purposes?.length) rows.push(detailRow(t("detail.purposes"), esc(slot.purposes.join(", "))));
  if (slot.memo) rows.push(detailRow(t("detail.memo"), esc(slot.memo)));
  return `<div class="details">${rows.join("")}</div>`;
}

function row(slot: Slot, ctx: RowContext): string {
  const state = slot.editor?.state ?? "closed";
  const open = ctx.expanded.has(slot.name);
  const git = ctx.gitOf(slot);
  const tags: string[] = [];
  if (slot.mode === "hot") tags.push(t("mode.hot"));
  if (slot.agentUse === false) tags.push(t("row.userOnly"));
  if (slot.kind === "worktree") tags.push(t("row.worktree"));
  // Names are long (whole project names), so the name keeps the first line and the git pills
  // sit at the end of the second line, wrapping under it when there is no room.
  return `<li class="slot state-${esc(state)} ${tint(slot)}${open ? " open" : ""}" data-toggle="${esc(slot.name)}" title="${esc(t(`state.${state}`))}">
    <div class="slot-head">
      <span class="dot" aria-hidden="true"></span>
      <span class="name" title="${esc(slot.name)}">${esc(slot.name)}</span>
      ${platformChip(slot.platform)}
      ${tags.length ? `<span class="tags">${tags.map(esc).join(" · ")}</span>` : ""}
      <span class="head-end">${memoryPill(slot, ctx)}</span>
    </div>
    <div class="slot-foot">
      <div class="slot-sub">${subLine(slot, git, ctx)}</div>
      ${gitPills(git, ctx)}
    </div>
    ${open ? details(slot, ctx) : ""}
  </li>`;
}

export function slotList(doc: Dashboard, ctx: RowContext): string {
  const slots = doc.slots ?? [];
  if (!slots.length) return `<p class="empty">${esc(t("empty.noSlots"))}</p>`;
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = s.repo || s.project || "-";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const html: string[] = [];
  for (const [name, members] of groups) {
    const openCount = members.filter(isOpen).length;
    const sorted = [...members.filter(isOpen), ...members.filter((s) => !isOpen(s))];
    html.push(`<section class="group">
      <div class="section-label"><span>${esc(name)}</span>${pill(
        "plain",
        "",
        `${openCount}/${members.length}`,
        t("row.openCount", { open: openCount, total: members.length }),
      )}</div>
      <ul class="slots">${sorted.map((s) => row(s, ctx)).join("")}</ul>
    </section>`);
  }
  return html.join("");
}

export function warningBand(list: Warning[], showAll: boolean): string {
  if (!list.length) return "";
  const shown = showAll ? list : list.slice(0, 2);
  const more = list.length - shown.length;
  return `<div class="band" data-action="toggle-warnings">${shown
    .map((w) => `<div class="warn-line ${w.severity}">${icon("alert", 12)}<span>${esc(w.text)}</span></div>`)
    .join("")}${more > 0 ? `<div class="warn-more">${esc(t("warnings.more", { n: more }))}</div>` : ""}</div>`;
}

export function eventsPanel(events: SlotEvent[], now: Date): string {
  // Newest first whatever order the core sends (0.4 sends newest first, at most 20).
  const items = [...events].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0)).slice(0, 20);
  const body = items.length
    ? items
        .map((e) => {
          const name = t(`event.${e.event}`);
          return `<li><span class="ev-time">${esc(formatWhen(e.time, now))}</span><span class="ev-name">${esc(
            name.startsWith("event.") ? e.event : name,
          )}</span><span class="ev-slot">${esc(e.slot ?? "")}</span><span class="ev-owner">${esc(e.owner ?? "")}</span></li>`;
        })
        .join("")
    : `<li class="muted">${esc(t("events.empty"))}</li>`;
  return `<section class="group events"><div class="section-label"><span>${esc(t("events.title"))}</span></div><ul>${body}</ul></section>`;
}

/** Header pills: open editors and system commit, colored by the alert settings. */
export function headerPills(open: number, max: number, percent: number | undefined, settings: WidgetSettings): string {
  // Muted unless something needs attention, like the plan text in the Claude widget.
  const out = [pill(open >= max && max > 0 ? "warn" : "plain", "", t("header.open", { open, max }), t("header.open", { open, max }))];
  if (typeof percent === "number") {
    const kind = percent >= settings.commitCriticalPercent ? "hot" : percent >= settings.commitWarnPercent ? "warn" : "plain";
    out.push(pill(kind, "", t("header.commit", { percent }), t("header.commit", { percent })));
  }
  return out.join('<span class="sep">·</span>');
}
