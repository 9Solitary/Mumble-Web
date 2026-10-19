import { describe, expect, it } from "vitest";
import { computeMicGate, type MicGateState } from "./micGate";

const base: MicGateState = {
  pttMode: "open",
  transmitting: false,
  selfMuted: false,
  selfDeafened: false,
  micReady: true,
  vadActive: false,
  continuousTransmit: false,
};

describe("computeMicGate", () => {
  it("自由发言 + 静音 + 自动门控：不开门（阈值 0 不再等于持续传输）", () => {
    expect(computeMicGate(base)).toBe(false);
  });

  it("VAD 检测到说话时开门", () => {
    expect(computeMicGate({ ...base, vadActive: true })).toBe(true);
  });

  it("持续传输显式开启才开门", () => {
    expect(computeMicGate({ ...base, continuousTransmit: true })).toBe(true);
  });

  it("按键说话只看 transmitting", () => {
    expect(computeMicGate({ ...base, pttMode: "ptt" })).toBe(false);
    expect(computeMicGate({ ...base, pttMode: "ptt", transmitting: true })).toBe(true);
  });

  it("静音/闭麦/麦克风未就绪时永远关门", () => {
    expect(computeMicGate({ ...base, continuousTransmit: true, selfMuted: true })).toBe(false);
    expect(computeMicGate({ ...base, continuousTransmit: true, selfDeafened: true })).toBe(false);
    expect(computeMicGate({ ...base, continuousTransmit: true, micReady: false })).toBe(false);
  });
});
