import { describe, expect, it } from "vitest";
import { computeJitterBufferDelayMs } from "./rtcStats";

describe("rtcStats 抖动缓冲区间延迟（Δdelay/Δcount）", () => {
  it("首次采样（无上一次基准）返回 null", () => {
    expect(
      computeJitterBufferDelayMs(null, { delay: 1.0, count: 100 }),
    ).toBeNull();
  });

  it("正常增量：区间平均延迟 = Δdelay/Δcount", () => {
    // (1.5 - 1.0) / (110 - 100) = 0.05s = 50ms
    const ms = computeJitterBufferDelayMs(
      { delay: 1.0, count: 100 },
      { delay: 1.5, count: 110 },
    );
    expect(ms).toBeCloseTo(50);
  });

  it("区间内 count 无增长时跳过（返回 null）", () => {
    const prev = { delay: 2.0, count: 100 };
    expect(
      computeJitterBufferDelayMs(prev, { delay: 2.5, count: 100 }),
    ).toBeNull();
    // count 回退（理论上不该发生，防御统计重置）也跳过
    expect(
      computeJitterBufferDelayMs(prev, { delay: 0.1, count: 50 }),
    ).toBeNull();
  });
});
