// 自动噪声门：自由发言模式下的麦克风门控。
//
// 设计目标：
// - 阈值 0 不再等于“持续传输”，静音时不应发送、也不应显示“正在发言”；
// - 自动跟随环境噪声，避免空调/风扇把门一直顶开；
// - 说话有 350ms 挂起，避免句子之间的短停顿把门关掉；
// - 纯逻辑、无 DOM 依赖，便于单测。
//
// 注意：level 是时域 RMS（0..1），来自 MumbleClient.getMicLevel()。

export interface NoiseGateOptions {
  holdMs?: number;
  minThreshold?: number;
  maxThreshold?: number;
  floorFall?: number;
  floorRise?: number;
  openRatio?: number;
}

export interface NoiseGateResult {
  active: boolean;
  threshold: number;
  floor: number;
}

export class NoiseGate {
  private readonly holdMs: number;
  private readonly minThreshold: number;
  private readonly maxThreshold: number;
  private readonly floorFall: number;
  private readonly floorRise: number;
  private readonly openRatio: number;

  private floor = 0.004;
  private openUntil = 0;

  // null = 自动；0..1 = 手动固定阈值
  manualThreshold: number | null = null;

  constructor(options: NoiseGateOptions = {}) {
    this.holdMs = options.holdMs ?? 350;
    this.minThreshold = options.minThreshold ?? 0.008;
    this.maxThreshold = options.maxThreshold ?? 0.08;
    this.floorFall = options.floorFall ?? 0.05;
    this.floorRise = options.floorRise ?? 0.0005;
    this.openRatio = options.openRatio ?? 1.15;
  }

  reset(): void {
    this.floor = 0.004;
    this.openUntil = 0;
  }

  update(level: number, now = performance.now()): NoiseGateResult {
    const value = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;

    // 噪声地板：安静时快速下降，有持续声音时缓慢上升。
    const factor = value < this.floor ? this.floorFall : this.floorRise;
    this.floor = clamp(this.floor + (value - this.floor) * factor, 0.001, 0.05);

    const autoThreshold = clamp(this.floor * 2.8, this.minThreshold, this.maxThreshold);
    const threshold = this.manualThreshold ?? autoThreshold;

    if (value >= threshold * this.openRatio) {
      this.openUntil = now + this.holdMs;
    }

    return {
      active: now < this.openUntil,
      threshold,
      floor: this.floor,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
