import { describe, expect, it } from "vitest";
import zh from "./locales/zh-CN.json";
import en from "./locales/en-US.json";

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, source);
}

describe("i18n 资源", () => {
  it("中英文 key 完全一致", () => {
    const zhKeys = flatten(zh).sort();
    const enKeys = flatten(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("没有空文案", () => {
    const empty = flatten(zh).filter((key) => {
      const value = valueAt(zh, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(empty).toEqual([]);
  });

  it("en-US 没有遗漏的中文文案（语言自称除外）", () => {
    // 语言选项按惯例使用自称：英文界面里“中文（简体）”应保持中文。
    const allowed = new Set(["settings.appearance.languageZh"]);
    const untranslated = flatten(en).filter((key) => {
      if (allowed.has(key)) return false;
      const value = valueAt(en, key);
      return typeof value === "string" && /[\u4e00-\u9fff]/.test(value);
    });
    expect(untranslated).toEqual([]);
  });
});
