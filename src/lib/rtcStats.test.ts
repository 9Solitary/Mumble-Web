import { describe, expect, it } from "vitest";
import {
  computeJitterBufferDelayMs,
  computeJitterBufferStats,
  type JitterBufferCounter,
} from "./rtcStats";

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

describe("rtcStats 多 track 抖动缓冲（computeJitterBufferStats）", () => {
  it("首次采样：区间值为 null，target/minimum 直接可取", () => {
    const prev = new Map<string, JitterBufferCounter>();
    const r = computeJitterBufferStats(prev, [
      {
        id: "in1",
        jitterBufferDelay: 1.0,
        jitterBufferEmittedCount: 100,
        jitterBufferTargetDelay: 0.1,
        jitterBufferMinimumDelay: 0.06,
      },
    ]);
    expect(r.intervalDelayMs).toBeNull(); // 首次无基准
    expect(r.targetMs).toBeCloseTo(100);
    expect(r.minimumMs).toBeCloseTo(60);
    expect(prev.get("in1")).toEqual({ delay: 1.0, count: 100 });
  });

  it("多 track 各自独立计算，不跨 track 混算", () => {
    const prev = new Map<string, JitterBufferCounter>();
    // 第一次采样：两路各自的基准
    computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.0, jitterBufferEmittedCount: 100 },
      { id: "in2", jitterBufferDelay: 5.0, jitterBufferEmittedCount: 400 },
    ]);
    // 第二次采样：in1 区间 (1.2-1.0)/(110-100)=20ms；in2 (5.4-5.0)/(420-400)=20ms
    const r = computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.2, jitterBufferEmittedCount: 110 },
      { id: "in2", jitterBufferDelay: 5.4, jitterBufferEmittedCount: 420 },
    ]);
    expect(r.intervalDelayMs).toBeCloseTo(20);
    // 若混算（in1 的基准配 in2 的当前值）会得到完全不同的大值，上式即证明未串扰
  });

  it("区间水位取各 track 最大值（最保守）", () => {
    const prev = new Map<string, JitterBufferCounter>();
    computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.0, jitterBufferEmittedCount: 100 },
      { id: "in2", jitterBufferDelay: 5.0, jitterBufferEmittedCount: 400 },
    ]);
    // in1: (1.5-1.0)/10=50ms；in2: (5.2-5.0)/20=10ms → 取最大 50ms
    const r = computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.5, jitterBufferEmittedCount: 110 },
      { id: "in2", jitterBufferDelay: 5.2, jitterBufferEmittedCount: 420 },
    ]);
    expect(r.intervalDelayMs).toBeCloseTo(50);
  });

  it("某路 count 无增长时跳过该路，其余路照常", () => {
    const prev = new Map<string, JitterBufferCounter>();
    computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.0, jitterBufferEmittedCount: 100 },
      { id: "in2", jitterBufferDelay: 5.0, jitterBufferEmittedCount: 400 },
    ]);
    const r = computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 9.9, jitterBufferEmittedCount: 100 }, // 无增长
      { id: "in2", jitterBufferDelay: 5.6, jitterBufferEmittedCount: 420 }, // 30ms
    ]);
    expect(r.intervalDelayMs).toBeCloseTo(30);
  });

  it("minimum/target 字段缺失时为 null", () => {
    const prev = new Map<string, JitterBufferCounter>();
    const r = computeJitterBufferStats(prev, [
      { id: "in1", jitterBufferDelay: 1.0, jitterBufferEmittedCount: 100 },
    ]);
    expect(r.targetMs).toBeNull();
    expect(r.minimumMs).toBeNull();
  });
});
