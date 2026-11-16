// Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/prefs.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBoolean, isNumber, isString, PREFS_PREFIX, readPref, writePref } from "./prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("prefs", () => {
  it("writes JSON under the app prefix and reads it back", () => {
    writePref("navOpen", true);
    writePref("bodyWidth", 420);
    expect(localStorage.getItem(`${PREFS_PREFIX}navOpen`)).toBe("true");
    expect(readPref("navOpen", false, isBoolean)).toBe(true);
    expect(readPref("bodyWidth", 0, isNumber)).toBe(420);
  });

  it("returns the fallback for a missing key, a wrong type or broken JSON", () => {
    expect(readPref("navTab", "projects", isString)).toBe("projects");
    localStorage.setItem(`${PREFS_PREFIX}navTab`, "42");
    expect(readPref("navTab", "projects", isString)).toBe("projects");
    localStorage.setItem(`${PREFS_PREFIX}navTab`, "{broken");
    expect(readPref("navTab", "projects", isString)).toBe("projects");
    localStorage.setItem(`${PREFS_PREFIX}bodyWidth`, "null");
    expect(readPref("bodyWidth", 420, isNumber)).toBe(420);
  });

  it("does not throw when the store is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => writePref("navOpen", true)).not.toThrow();
    expect(readPref("navOpen", false, isBoolean)).toBe(false);
  });

  it("leaves other prefixes alone", () => {
    localStorage.setItem("navOpen", "true");
    expect(readPref("navOpen", false, isBoolean)).toBe(false);
  });
});
