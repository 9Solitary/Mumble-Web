// 麦克风门控：把“是否发送”从 store 里抽成纯函数，便于单测。
// 关键语义：自由发言模式下只有 vadActive 或 continuousTransmit 才开门，
// 不再把“阈值为 0”当成持续传输。

export interface MicGateState {
  pttMode: "ptt" | "open";
  transmitting: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  micReady: boolean;
  vadActive: boolean;
  continuousTransmit: boolean;
}

export function computeMicGate(state: MicGateState): boolean {
  const { pttMode, transmitting, selfMuted, selfDeafened, micReady, vadActive, continuousTransmit } =
    state;
  const gateOpen =
    pttMode === "open" ? continuousTransmit || vadActive : transmitting;
  return gateOpen && !selfMuted && !selfDeafened && micReady;
}
