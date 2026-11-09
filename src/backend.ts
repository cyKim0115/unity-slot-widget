/**
 * Calls into the Rust side, or a stand-in when the page runs in a plain browser
 * (`npm run dev`, then open http://localhost:1431/?sample=dashboard). The stand-in reads
 * `samples/<name>.sample.json` and does nothing for window commands, so the screens can be
 * checked and clicked without Tauri.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

const PREVIEW_SETTINGS = {
  language: new URLSearchParams(location.search).get("lang") ?? "auto",
  alwaysOnTop: true,
  glass: false,
  glassBlur: 12,
  idleSecs: 30,
  startingSecs: 5,
  gitFullMins: 5,
  signalSecs: 3,
  commitWarnPercent: 85,
  commitCriticalPercent: 90,
  slotMemoryWarnGb: 10,
  localOnlyWarnDays: 3,
  localOnlyCriticalDays: 14,
  openTarget: "fork",
  unitySlotScript: "",
  sampleFile: "",
};

async function preview(cmd: string): Promise<unknown> {
  switch (cmd) {
    case "get_settings":
    case "save_settings":
      return PREVIEW_SETTINGS;
    case "get_dashboard": {
      const name = new URLSearchParams(location.search).get("sample") ?? "dashboard";
      const response = await fetch(`/samples/${encodeURIComponent(name)}.sample.json`);
      if (!response.ok) throw `sample:${response.status}`;
      return { document: await response.json(), ms: 0, source: "sample", script: null };
    }
    case "get_core_location":
      return { script: null, source: "none", slotHome: "(preview)" };
    case "set_glass":
    case "glass_supported":
    case "is_dev_build":
    case "is_autostart_enabled":
      return false;
    default:
      return null;
  }
}

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (inTauri ? invoke<T>(cmd, args) : preview(cmd)) as Promise<T>;
}

export async function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inTauri) return () => {};
  return listen<T>(event, (e) => handler(e.payload));
}

export async function isWindowVisible(): Promise<boolean> {
  if (!inTauri) return true;
  try {
    return await getCurrentWindow().isVisible();
  } catch {
    return true;
  }
}
