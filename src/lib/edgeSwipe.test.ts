import { describe, expect, it } from "vitest";
import { detectEdgeSwipe } from "./edgeSwipe";

const base = {
  startY: 400,
  endY: 400,
  width: 390,
};

describe("detectEdgeSwipe", () => {
  it("左缘向右滑打开频道，右缘向左滑打开成员", () => {
    expect(
      detectEdgeSwipe({ ...base, startX: 5, endX: 140 }),
    ).toBe("channels");
    expect(
      detectEdgeSwipe({ ...base, startX: 385, endX: 250 }),
    ).toBe("members");
  });

  it("距离不够、垂直位移过大或起点不在边缘时不触发", () => {
    expect(
      detectEdgeSwipe({ ...base, startX: 5, endX: 50 }),
    ).toBeNull();
    expect(
      detectEdgeSwipe({ ...base, startX: 5, endX: 140, endY: 520 }),
    ).toBeNull();
    expect(
      detectEdgeSwipe({ ...base, startX: 100, endX: 260 }),
    ).toBeNull();
    expect(
      detectEdgeSwipe({ ...base, startX: 385, endX: 400 }),
    ).toBeNull();
  });

  it("反方向滑动不触发", () => {
    expect(
      detectEdgeSwipe({ ...base, startX: 5, endX: -80 }),
    ).toBeNull();
    expect(
      detectEdgeSwipe({ ...base, startX: 385, endX: 520 }),
    ).toBeNull();
  });
});
