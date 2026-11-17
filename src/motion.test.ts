import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MOVING, fadeIn, motionAllowed, playList, snapshotList } from "./motion";

/** jsdom has no layout: each element reports the top written in data-top. */
function layout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = Number((this as HTMLElement).dataset?.top ?? 0);
    return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

/** Same shape as the slot list: a group head and slot rows, each an item with a key. */
function draw(inner: HTMLElement, rows: Array<[string, string, number]>, groupTop = 0): void {
  inner.innerHTML = `<section class="group" data-group="G"><div class="item group-head" data-item="g:G" data-top="${groupTop}"></div><ul class="slots">${rows
    .map(([name, state, top]) => `<li class="item slot state-${state}" data-item="s:${name}" data-top="${top}"></li>`)
    .join("")}</ul></section>`;
}

let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="list-inner"></div></div>`;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  animate = vi.fn();
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  layout();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

const inner = () => document.getElementById("list-inner")!;
const animated = () => animate.mock.contexts.map((el) => (el as HTMLElement).dataset.item ?? (el as HTMLElement).id);
const row = (name: string) => inner().querySelector<HTMLElement>(`[data-item="s:${name}"]`)!;

describe("playList", () => {
  it("slides a slot that moved up when its editor opened, and glows it once", () => {
    draw(inner(), [["A", "ready", 0], ["B", "closed", 20], ["C", "closed", 40]]);
    const before = snapshotList(inner(), "slots");
    draw(inner(), [["A", "ready", 0], ["C", "starting", 20], ["B", "closed", 40]]);
    playList(inner(), before, "slots");
    expect(animated().sort()).toEqual(["s:B", "s:C"]);
    const cCall = animate.mock.calls[animate.mock.contexts.indexOf(row("C"))];
    expect(cCall[0][0].transform).toBe("translateY(20px)");
    expect(row("C").classList.contains("glow-open")).toBe(true);
    expect(row("B").classList.contains("glow-open")).toBe(false);
  });

  it("glows a slot that became ready without moving it", () => {
    draw(inner(), [["A", "starting", 0]]);
    const before = snapshotList(inner(), "slots");
    draw(inner(), [["A", "ready", 0]]);
    playList(inner(), before, "slots");
    expect(animate).not.toHaveBeenCalled();
    expect(row("A").classList.contains("glow-ready")).toBe(true);
  });

  it("fades in an item that was not there", () => {
    draw(inner(), [["A", "ready", 0]]);
    const before = snapshotList(inner(), "slots");
    draw(inner(), [["A", "ready", 0], ["B", "closed", 20]]);
    playList(inner(), before, "slots");
    expect(animated()).toEqual(["s:B"]);
    expect(animate.mock.calls[0][0][0].opacity).toBe(0);
  });

  it("slides the group head with its group", () => {
    draw(inner(), [["A", "ready", 10]], 0);
    const before = snapshotList(inner(), "slots");
    draw(inner(), [["A", "ready", 40]], 30);
    playList(inner(), before, "slots");
    expect(animated().sort()).toEqual(["g:G", "s:A"]);
  });

  it("fades the whole list in when another screen is drawn", () => {
    draw(inner(), [["A", "ready", 0]]);
    const before = snapshotList(inner(), "slots");
    draw(inner(), [["B", "ready", 0]]);
    playList(inner(), before, "branches");
    expect(animated()).toEqual(["list-inner"]);
  });

  it("plays nothing on the first draw, while hidden, with no-anim, or for too many items", () => {
    draw(inner(), [["A", "closed", 0]]);
    playList(inner(), null, "slots");
    expect(animate).not.toHaveBeenCalled();

    const before = snapshotList(inner(), "slots");
    draw(inner(), [["A", "ready", 0], ["B", "ready", 20]]);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    playList(inner(), before, "slots");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.getElementById("app")!.classList.add("no-anim");
    playList(inner(), before, "slots");
    document.getElementById("app")!.classList.remove("no-anim");
    expect(animate).not.toHaveBeenCalled();
    expect(inner().querySelector(".glow-open")).toBeNull();

    draw(inner(), [["A", "ready", 0]]);
    const many = snapshotList(inner(), "slots");
    draw(
      inner(),
      Array.from({ length: MAX_MOVING + 1 }, (_, i): [string, string, number] => [`R${i}`, "closed", i * 20]),
    );
    playList(inner(), many, "slots");
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("fadeIn", () => {
  it("plays once when allowed and not at all without animate()", () => {
    const el = document.createElement("div");
    fadeIn(el);
    expect(animate).toHaveBeenCalledTimes(1);
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    expect(motionAllowed()).toBe(false);
    fadeIn(el);
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
