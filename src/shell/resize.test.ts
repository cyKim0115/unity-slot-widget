// Adapted from https://github.com/cyKim0115/Frond/ @99d89bc, MIT, same author (src/resize.test.ts).
import { describe, expect, it } from "vitest";
import { BODY_DEFAULT_W, BODY_MIN_W, bodyMaxWidth, resolveBodyWidth } from "./resize";

describe("resolveBodyWidth", () => {
  it("keeps a width inside the range", () => {
    expect(resolveBodyWidth(BODY_DEFAULT_W, 1200)).toBe(BODY_DEFAULT_W);
  });

  it("raises a narrow width to the minimum and folds below half of it", () => {
    expect(resolveBodyWidth(BODY_MIN_W - 20, 1200)).toBe(BODY_MIN_W);
    expect(resolveBodyWidth(BODY_MIN_W / 2 - 1, 1200)).toBeNull();
  });

  it("leaves the list its share of the room", () => {
    expect(resolveBodyWidth(900, 1000)).toBe(600);
    expect(bodyMaxWidth(1000)).toBe(600);
  });

  it("lets the minimum win in a very narrow window", () => {
    expect(resolveBodyWidth(320, 300)).toBe(BODY_MIN_W);
    expect(bodyMaxWidth(300)).toBe(BODY_MIN_W);
  });
});
