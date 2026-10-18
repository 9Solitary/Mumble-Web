import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyJitterBufferTarget,
  isJitterBufferTargetSupported,
  LOW_LATENCY_BUFFER_MS,
  resetJitterBufferForTest,
} from "./jitterBuffer";
import { getEvents, resetDiagnosticsForTest } from "./diagnostics";

// 伪 RTCPtpReceiver 类：jitterBufferTarget 挂在原型上（特性检测查的是原型）
class FakeReceiverSupported {}
Object.assign(FakeReceiverSupported.prototype, { jitterBufferTarget: null });
class FakeReceiverUnsupported {} // 原型上没有该属性

describe("jitterBuffer 低延迟接收缓冲", () => {
  beforeEach(() => {
    resetJitterBufferForTest();
    resetDiagnosticsForTest();
    vi.stubEnv("VITE_DIAG_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("特性检测：原型上有属性则支持，否则不支持并记录一次诊断", () => {
    vi.stubGlobal("RTCRtpReceiver", FakeReceiverUnsupported);
    expect(isJitterBufferTargetSupported()).toBe(false);
    expect(isJitterBufferTargetSupported()).toBe(false);
    const logs = getEvents().filter((e) => e.kind === "jitter-buffer");
    expect(logs).toHaveLength(1); // 只记一次
    expect(logs[0].data.supported).toBe(false);
  });

  it("开启：receiver 目标缓冲设为 100ms", () => {
    vi.stubGlobal("RTCRtpReceiver", FakeReceiverSupported);
    const receiver = { jitterBufferTarget: null } as unknown as RTCRtpReceiver;
    expect(applyJitterBufferTarget(receiver, true)).toBe(true);
    expect(receiver.jitterBufferTarget).toBe(LOW_LATENCY_BUFFER_MS);
  });

  it("关闭：设回 null 恢复浏览器默认自适应", () => {
    vi.stubGlobal("RTCRtpReceiver", FakeReceiverSupported);
    const receiver = {
      jitterBufferTarget: LOW_LATENCY_BUFFER_MS,
    } as unknown as RTCRtpReceiver;
    expect(applyJitterBufferTarget(receiver, false)).toBe(true);
    expect(receiver.jitterBufferTarget).toBeNull();
  });

  it("不支持时静默跳过（返回 false，不写值）", () => {
    vi.stubGlobal("RTCRtpReceiver", FakeReceiverUnsupported);
    const receiver = { jitterBufferTarget: 999 } as unknown as RTCRtpReceiver;
    expect(applyJitterBufferTarget(receiver, true)).toBe(false);
    expect(receiver.jitterBufferTarget).toBe(999);
  });

  it("赋值抛错且关闭时：回退到大值 3000", () => {
    vi.stubGlobal("RTCRtpReceiver", FakeReceiverSupported);
    const receiver = {} as { jitterBufferTarget: number | null };
    let nullRejected = false;
    Object.defineProperty(receiver, "jitterBufferTarget", {
      set(v: number | null) {
        if (v === null) {
          nullRejected = true;
          throw new TypeError("null not allowed");
        }
        this._v = v;
      },
      get() {
        return (this._v ?? null) as number | null;
      },
    });
    expect(
      applyJitterBufferTarget(receiver as unknown as RTCRtpReceiver, false),
    ).toBe(true);
    expect(nullRejected).toBe(true);
    expect(receiver.jitterBufferTarget).toBe(3000);
  });
});
