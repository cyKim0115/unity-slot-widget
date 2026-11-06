/**
 * Background blur. glass.rs captures the screen behind the widget; this draws the frame on a
 * canvas under the card and CSS blurs it. Off by default.
 */

/** Same as glass.rs MAX_BLUR_PX and the settings slider max. */
export const MAX_GLASS_BLUR = 32;

export type GlassFrame = { seq: number; width: number; height: number; margin: number };

let busy = false;
let pending: GlassFrame | null = null;

function canvas(): HTMLCanvasElement | null {
  return document.getElementById("glass-backdrop") as HTMLCanvasElement | null;
}

/** The card goes translucent only while the blur is really on; without it text behind would show. */
export function setGlassClass(applied: boolean) {
  document.documentElement.classList.toggle("glass", applied);
  const c = canvas();
  if (!applied && c) {
    c.width = 0;
    c.height = 0;
  }
}

export function setGlassBlur(px: number) {
  document.documentElement.style.setProperty("--glass-blur", `${Math.min(MAX_GLASS_BLUR, Math.max(0, px))}px`);
}

export function onGlassFrame(frame: GlassFrame) {
  if (!document.documentElement.classList.contains("glass")) return;
  if (busy) {
    pending = frame;
    return;
  }
  void draw(frame);
}

async function draw(frame: GlassFrame) {
  busy = true;
  try {
    const response = await fetch(`http://glassbg.localhost/frame?${frame.seq}`);
    const bytes = new Uint8ClampedArray(await response.arrayBuffer());
    const c = canvas();
    if (!c || bytes.length !== frame.width * frame.height * 4) return;
    if (c.width !== frame.width || c.height !== frame.height) {
      c.width = frame.width;
      c.height = frame.height;
    }
    const scale = window.devicePixelRatio || 1;
    const border = document.querySelector<HTMLElement>(".widget")?.clientLeft ?? 0;
    c.style.width = `${frame.width / scale}px`;
    c.style.height = `${frame.height / scale}px`;
    c.style.left = `${-frame.margin / scale - border}px`;
    c.style.top = `${-frame.margin / scale - border}px`;
    c.getContext("2d")?.putImageData(new ImageData(bytes, frame.width, frame.height), 0, 0);
  } catch {
    /* the next frame draws again */
  } finally {
    busy = false;
    const next = pending;
    pending = null;
    if (next && document.documentElement.classList.contains("glass")) void draw(next);
  }
}
