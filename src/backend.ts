/**
 * Calls into the Rust side, or a stand-in when the page runs in a plain browser
 * (`npm run dev`, then open http://localhost:1431/?sample=dashboard). The stand-in reads
 * `samples/<name>.sample.json` and does nothing for window commands, so the screens can be
 * checked and clicked without Tauri.
 *
 * Preview query (browser only): ?sample=<name> ?lang=ko|en ?theme=system|light|dark
 * ?view=slots|branches ?select=<slot or item key: g:<project>, x:extra, e:<pid>, bb:<project>/<branch>>
 * ?branch=<name> ?bfilter=attention|checkedout|all ?bslot=<slot> ?project=<name>
 * ?filter=all|open|attention ?nav=projects|warnings|log|closed ?body=hidden ?sheet=open
 * ?frame=<width>x<height> (main.ts).
 *
 * The view repository button (core 0.7.0 `branch-view`) is off for sample data. With ?core=1 the
 * sample counts as a core's answer, and a stand-in plans and "makes" view repositories in memory
 * (nothing is written); ?bv=fail makes every run fail, ?bv=slow takes 4 s.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

const query = new URLSearchParams(location.search);
const previewTheme = query.get("theme");

/** The last sample read (the branch-view stand-in plans from its slots). */
let lastSample: Record<string, unknown> | null = null;
/** View repositories the stand-in "made", by registry project (lower case). */
const previewViews = new Map<string, Record<string, unknown>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `branch-view -Json` for the sample's project: a plan, or a run that only updates the stand-in's memory. */
async function previewBranchView(project: string, apply: boolean): Promise<unknown> {
  await sleep(query.get("bv") === "slow" ? 4000 : 900);
  const slots = ((lastSample?.slots as { name: string; path: string; project?: string; repo?: string }[] | undefined) ?? []).filter(
    (s) => (s.project ?? "").toLowerCase() === project.toLowerCase(),
  );
  const repo = slots[0]?.repo ?? project.split("/").pop() ?? "view";
  const key = project.toLowerCase();
  const path = `C:\\Views\\${repo}.git`;
  const now = new Date().toISOString();
  const had = previewViews.get(key);
  const failing = query.get("bv") === "fail";
  const entry = {
    project: key,
    repo,
    path,
    createdAt: had?.createdAt ?? null,
    updatedAt: had?.updatedAt ?? null,
    coreVersion: "0.7.0",
    origin: { filledFrom: slots[0]?.name ?? null, rejected: [] },
    error: failing && apply ? "git fetch failed (preview)" : null,
    name: repo,
    exists: !!had,
    action: failing && apply ? "error" : had ? "refresh" : "create",
    reason: null,
    remotes: { add: had ? [] : slots.map((s) => s.name), update: [], remove: [], conflict: [] },
    sizeBytes: had ? 640_000_000 : null,
    estimatedBytes: had ? null : 614_000_000,
    seconds: 0.9,
    slots: slots.map((s) => ({ slot: s.name, remote: s.name, path: s.path, status: apply ? "fetched" : null, action: apply ? "fetched" : "fetch", fetchedAt: apply ? now : null, changedSince: apply ? false : true, error: null })),
  };
  if (apply && !failing) {
    previewViews.set(key, {
      project: key,
      repo,
      path,
      createdAt: had?.createdAt ?? now,
      updatedAt: now,
      coreVersion: "0.7.0",
      slots: entry.slots.map(({ slot, remote, status, fetchedAt }) => ({ slot, remote, status, fetchedAt, changedSince: false, error: null })),
      origin: entry.origin,
      error: null,
    });
  }
  return { document: { schema: "unity-slot.branch-view/1", version: "0.7.0", apply, root: "C:\\Views", views: [entry] }, exitCode: failing && apply ? 1 : 0 };
}

/** Stands in for widget.json; keys left out take their defaults (src/settings.ts). */
const PREVIEW_SETTINGS: Record<string, unknown> = {
  language: query.get("lang") ?? "auto",
  theme: previewTheme === "light" || previewTheme === "dark" ? previewTheme : "system",
};

async function preview(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case "get_settings":
      return { ...PREVIEW_SETTINGS };
    case "update_settings":
      // Same answer as the Rust side: the whole settings after merging the changed keys
      Object.assign(PREVIEW_SETTINGS, (args?.patch as Record<string, unknown>) ?? {});
      return { ...PREVIEW_SETTINGS };
    case "get_dashboard": {
      const name = query.get("sample") ?? "dashboard";
      const response = await fetch(`/samples/${encodeURIComponent(name)}.sample.json`);
      if (!response.ok) throw `sample:${response.status}`;
      const document = (await response.json()) as Record<string, unknown>;
      lastSample = document;
      // ?core=1: the views the stand-in made replace the sample's own
      if (query.has("core") && "branchViews" in document) {
        const own = ((document.branchViews as { project?: string }[] | null) ?? []).filter((v) => !previewViews.has((v.project ?? "").toLowerCase()));
        document.branchViews = [...own, ...previewViews.values()];
      }
      return { document, ms: 0, source: query.has("core") ? "core" : "sample", script: null };
    }
    case "branch_view":
      if (!query.has("core")) throw "sample";
      return previewBranchView(String(args?.project ?? ""), args?.apply === true);
    case "get_core_location":
      return { script: null, source: "none", slotHome: "(preview)" };
    case "get_app_info":
      return { version: "0.0.0-preview", settingsFile: "(preview)\\widget.json", slotHome: "(preview)", dev: true };
    case "open_in_unity":
      return { outcome: "started", pid: null, warnings: [] };
    case "release_stale_lease":
      // Like the Rust side: nothing for sample data, except the ?core=1 stand-in
      if (!query.has("core")) throw "sample";
      await sleep(400);
      return { outcome: "released" };
    case "is_autostart_enabled":
      return false;
    default:
      return null;
  }
}

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (inTauri ? invoke<T>(cmd, args) : preview(cmd, args)) as Promise<T>;
}

export async function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return () => {};
  return listen<T>(event, (e) => handler(e.payload));
}

/**
 * False only while the window is hidden to the tray (or not shown yet). A minimized window counts
 * as visible (IsWindowVisible), so refreshing goes on while minimized and the taskbar badge and
 * the tray tooltip stay current.
 */
export async function isWindowVisible(): Promise<boolean> {
  if (!inTauri) return true;
  try {
    return await getCurrentWindow().isVisible();
  } catch {
    return true;
  }
}
