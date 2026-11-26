import { describe, expect, it } from "vitest";
import { edgeAt } from "./frame";

describe("edgeAt", () => {
  const W = 1000;
  const H = 700;
  const M = 8;

  it("is null inside the card and without a margin", () => {
    expect(edgeAt(500, 350, W, H, M)).toBeNull();
    expect(edgeAt(8, 8, W, H, M)).toBeNull();
    expect(edgeAt(2, 2, W, H, 0)).toBeNull();
  });

  it("names the edge of the margin", () => {
    expect(edgeAt(500, 3, W, H, M)).toBe("North");
    expect(edgeAt(500, 696, W, H, M)).toBe("South");
    expect(edgeAt(2, 350, W, H, M)).toBe("West");
    expect(edgeAt(995, 350, W, H, M)).toBe("East");
  });

  it("names a corner near the ends of an edge", () => {
    expect(edgeAt(2, 2, W, H, M)).toBe("NorthWest");
    expect(edgeAt(12, 3, W, H, M)).toBe("NorthWest");
    expect(edgeAt(3, 12, W, H, M)).toBe("NorthWest");
    expect(edgeAt(990, 3, W, H, M)).toBe("NorthEast");
    expect(edgeAt(3, 690, W, H, M)).toBe("SouthWest");
    expect(edgeAt(996, 696, W, H, M)).toBe("SouthEast");
    expect(edgeAt(20, 3, W, H, M)).toBe("North");
  });
});
