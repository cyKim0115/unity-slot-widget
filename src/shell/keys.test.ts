import { afterEach, describe, expect, it, vi } from "vitest";
import { createShortcutHandler, matchesCombo, parseCombo } from "./keys";

function key(init: KeyboardEventInit & { keyCode?: number }, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("combos", () => {
  it("matches letters and digits by physical key, whatever the layout", () => {
    const combo = parseCombo("Ctrl+Shift+D");
    expect(matchesCombo(key({ ctrlKey: true, shiftKey: true, code: "KeyD", key: "\u3147" }), combo)).toBe(true);
    expect(matchesCombo(key({ ctrlKey: true, code: "KeyD", key: "d" }), combo)).toBe(false);
    expect(matchesCombo(key({ metaKey: true, code: "Digit1", key: "1" }), parseCombo("Ctrl+1"))).toBe(true);
    expect(matchesCombo(key({ ctrlKey: true, code: "Backslash", key: "\\" }), parseCombo("Ctrl+\\"))).toBe(true);
  });

  it("matches named keys and exact modifiers", () => {
    expect(matchesCombo(key({ key: "F5", code: "F5" }), parseCombo("F5"))).toBe(true);
    expect(matchesCombo(key({ key: "F5", code: "F5", shiftKey: true }), parseCombo("F5"))).toBe(false);
    expect(matchesCombo(key({ key: "F5", code: "F5", shiftKey: true }), parseCombo("Shift+F5"))).toBe(true);
  });
});

describe("createShortcutHandler", () => {
  it("runs the first matching shortcut and takes the key", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ keys: "Ctrl+Shift+D", run }]);
    const event = key({ ctrlKey: true, shiftKey: true, code: "KeyD", key: "D" });
    handler(event);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves keys alone during IME composition", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ keys: "Enter", run }]);
    handler(key({ key: "Enter", isComposing: true }));
    handler(key({ key: "Process", keyCode: 229 }));
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves keys to an open dialog", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const run = vi.fn();
    createShortcutHandler([{ keys: "F5", run }])(key({ key: "F5" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("skips text fields unless the shortcut allows them", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const copy = vi.fn();
    const close = vi.fn();
    const handler = createShortcutHandler([
      { keys: "Ctrl+C", run: copy },
      { keys: "Escape", run: close, inFields: true },
    ]);
    const ctrlC = key({ ctrlKey: true, code: "KeyC", key: "c" }, input);
    handler(ctrlC);
    expect(copy).not.toHaveBeenCalled();
    expect(ctrlC.defaultPrevented).toBe(false);
    handler(key({ key: "Escape" }, input));
    expect(close).toHaveBeenCalledOnce();
  });

  it("goes on when a shortcut returns false", () => {
    const first = vi.fn(() => false as const);
    const second = vi.fn();
    const event = key({ key: "Enter" });
    createShortcutHandler([
      { keys: "Enter", run: first },
      { keys: "Enter", run: second },
    ])(event);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});
