import { describe, expect, it } from "vitest";
import { createBackoff } from "./reconnect";

describe("createBackoff 退避计算器", () => {
  it("指数增长：1s/2s/4s/8s…（rand=0.5 时抖动为 0）", () => {
    const b = createBackoff({ rand: () => 0.5 });
    expect(b.next()).toBe(1000);
    expect(b.next()).toBe(2000);
    expect(b.next()).toBe(4000);
    expect(b.next()).toBe(8000);
  });

  it("封顶 30s", () => {
    const b = createBackoff({ rand: () => 0.5 });
    const seq = Array.from({ length: 10 }, () => b.next());
    // 1,2,4,8,16,30,30,30,30,30（秒）
    expect(seq).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000,
    ]);
  });

  it("jitter 范围：±20% 以内", () => {
    // rand=0 → 下限 80%；rand≈1 → 上限趋近 120%
    const low = createBackoff({ rand: () => 0 });
    expect(low.next()).toBe(800);
    const high = createBackoff({ rand: () => 0.9999 });
    const v = high.next();
    expect(v).toBeLessThanOrEqual(1200);
    expect(v).toBeGreaterThan(1000);
  });

  it("jitter=0 时返回精确基数", () => {
    const b = createBackoff({ jitter: 0 });
    expect(b.next()).toBe(1000);
    expect(b.next()).toBe(2000);
  });

  it("reset() 归零后重新从 1s 开始", () => {
    const b = createBackoff({ rand: () => 0.5 });
    b.next();
    b.next();
    expect(b.attempts()).toBe(2);
    b.reset();
    expect(b.attempts()).toBe(0);
    expect(b.next()).toBe(1000);
  });
});
