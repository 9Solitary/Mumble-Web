import { describe, expect, it } from "vitest";
import { clampZoom, pinchZoom, swipeDirection } from "./lightbox";

describe("pinchZoom", () => {
  it("按距离比例缩放并限制边界", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 100, 50)).toBe(1);
    expect(pinchZoom(1, 0, 200)).toBe(1);
    expect(pinchZoom(1, 100, Number.NaN)).toBe(1);
    expect(pinchZoom(7, 100, 400)).toBe(8);
    expect(clampZoom(0.01)).toBe(0.05);
    expect(clampZoom(20)).toBe(8);
  });
});

describe("swipeDirection", () => {
  it("只接受足够长的水平位移", () => {
    expect(swipeDirection(-120, 10)).toBe(1);
    expect(swipeDirection(120, 10)).toBe(-1);
    expect(swipeDirection(-40, 0)).toBe(0);
    expect(swipeDirection(-120, 90)).toBe(0);
    expect(swipeDirection(0, 120)).toBe(0);
  });
});
