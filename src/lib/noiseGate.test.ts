import { describe, expect, it } from "vitest";
import { NoiseGate } from "./noiseGate";

describe("NoiseGate 自动噪声门", () => {
  it("静音时不打开，触发阈值保持最小值", () => {
    const gate = new NoiseGate();
    let result = gate.update(0, 0);
    for (let t = 50; t <= 2000; t += 50) result = gate.update(0, t);
    expect(result.active).toBe(false);
    expect(result.threshold).toBeCloseTo(0.008, 4);
  });

  it("说话时立即打开，停顿后挂起 350ms 再关闭", () => {
    const gate = new NoiseGate();
    let result = gate.update(0, 0);
    result = gate.update(0.2, 50);
    expect(result.active).toBe(true);

    // 停止说话：持续到 350ms 挂起结束
    result = gate.update(0, 200);
    expect(result.active).toBe(true);
    result = gate.update(0, 390);
    expect(result.active).toBe(true);
    result = gate.update(0, 420);
    expect(result.active).toBe(false);
  });

  it("持续的环境噪声不会把门一直顶开", () => {
    const gate = new NoiseGate();
    let result = gate.update(0, 0);
    for (let t = 50; t <= 4000; t += 50) result = gate.update(0.012, t);
    expect(result.floor).toBeGreaterThan(0.004);
    expect(result.threshold).toBeGreaterThan(0.011);
    expect(result.active).toBe(false);
  });

  it("安静环境里的小声说话仍能触发", () => {
    const gate = new NoiseGate();
    let result = gate.update(0, 0);
    for (let t = 50; t <= 1000; t += 50) gate.update(0.001, t);
    result = gate.update(0.02, 1050);
    expect(result.active).toBe(true);
  });

  it("手动阈值覆盖自动触发阈值", () => {
    const gate = new NoiseGate();
    gate.manualThreshold = 0.1;
    expect(gate.update(0.05, 50).active).toBe(false);
    expect(gate.update(0.12, 100).active).toBe(true);
    expect(gate.update(0, 200).threshold).toBeCloseTo(0.1, 4);
  });

  it("reset 后回到初始状态", () => {
    const gate = new NoiseGate();
    gate.update(0.5, 50);
    gate.reset();
    const result = gate.update(0, 100);
    expect(result.active).toBe(false);
    expect(result.floor).toBeLessThanOrEqual(0.004);
  });
});
