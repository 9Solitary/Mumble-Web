import { describe, expect, it } from "vitest";
import {
  dbToPercent,
  dbToRms,
  rmsToDb,
  THRESHOLD_MAX_DB,
  THRESHOLD_MIN_DB,
} from "./audioLevel";

describe("audioLevel dB 换算", () => {
  it("RMS 转 dBFS", () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 5);
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 5);
    expect(rmsToDb(0.05)).toBeCloseTo(-26.02, 1);
    expect(rmsToDb(0.001)).toBeCloseTo(-60, 5);
    expect(rmsToDb(0)).toBe(-60);
    expect(rmsToDb(-1)).toBe(-60);
  });

  it("dBFS 转 RMS", () => {
    expect(dbToRms(0)).toBeCloseTo(1, 5);
    expect(dbToRms(-20)).toBeCloseTo(0.1, 5);
    expect(dbToRms(-40)).toBeCloseTo(0.01, 5);
    expect(dbToRms(-60)).toBeCloseTo(0.001, 5);
  });

  it("电平条映射：正常说话落在右半边", () => {
    expect(dbToPercent(-60)).toBe(0);
    expect(dbToPercent(0)).toBe(100);
    expect(dbToPercent(-30)).toBe(50);
    expect(dbToPercent(-26)).toBeGreaterThan(50);
    expect(dbToPercent(-14)).toBeGreaterThan(70);
  });

  it("阈值范围 -60..-6 dB", () => {
    expect(THRESHOLD_MIN_DB).toBe(-60);
    expect(THRESHOLD_MAX_DB).toBe(-6);
    expect(dbToRms(THRESHOLD_MIN_DB)).toBeCloseTo(0.001, 5);
    expect(dbToRms(THRESHOLD_MAX_DB)).toBeCloseTo(0.501, 3);
  });
});
