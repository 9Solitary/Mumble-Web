// 音频电平的显示/阈值换算。
//
// 麦克风返回的是线性 RMS；人耳和“阈值”的手感都是对数的，所以 UI 统一用 dBFS：
//   dBFS = 20 * log10(rms)
// 电平表显示 -60..0 dB，阈值显示 -60..-6 dB。
// 0 dB 是满刻度，-60 dB 是显示下限；数值越低越灵敏。

export const METER_FLOOR_DB = -60;
export const METER_CEIL_DB = 0;

export const THRESHOLD_MIN_DB = -60;
export const THRESHOLD_MAX_DB = -6;
export const DEFAULT_MANUAL_THRESHOLD_DB = -40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return METER_FLOOR_DB;
  return clamp(20 * Math.log10(rms), METER_FLOOR_DB, METER_CEIL_DB);
}

export function dbToRms(db: number): number {
  return Math.pow(10, clamp(db, METER_FLOOR_DB, METER_CEIL_DB) / 20);
}

// 把 dB 映射到电平条/滑条的 0..100 位置。
export function dbToPercent(db: number): number {
  return (
    clamp(
      (db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB),
      0,
      1,
    ) * 100
  );
}

export function clampThresholdDb(db: number): number {
  return clamp(db, THRESHOLD_MIN_DB, THRESHOLD_MAX_DB);
}

// 四舍五入到 1 dB，用于展示与滑条取值。
export function roundDb(db: number): number {
  return Math.round(db);
}
