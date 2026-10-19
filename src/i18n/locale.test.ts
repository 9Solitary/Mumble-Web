import { afterAll, beforeEach, describe, expect, it } from "vitest";
import i18n, {
  LOCALE_STORAGE_KEY,
  detectLocale,
  normalizeLocale,
  setLocale,
} from "./index";

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    get: () => languages,
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    get: () => languages[0] ?? "en-US",
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  setBrowserLanguages(["en-US"]);
});

afterAll(async () => {
  await i18n.changeLanguage("en-US");
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("normalizeLocale", () => {
  it("接受 en / zh 及其地区变体", () => {
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh_CN")).toBe("zh-CN");
    expect(normalizeLocale("fr")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });
});

describe("detectLocale 优先级", () => {
  it("URL 优先于 localStorage 和浏览器", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    setBrowserLanguages(["en-US"]);
    window.history.replaceState({}, "", "/?lang=zh");
    expect(detectLocale()).toBe("zh-CN");
  });

  it("localStorage 优先于浏览器", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    setBrowserLanguages(["zh-CN"]);
    expect(detectLocale()).toBe("en-US");
  });

  it("浏览器中文落到 zh-CN，非中文落到 en-US 回退", () => {
    setBrowserLanguages(["zh-Hans-CN", "en-US"]);
    expect(detectLocale()).toBe("zh-CN");

    setBrowserLanguages(["fr-FR", "en-GB"]);
    expect(detectLocale()).toBe("en-US");

    setBrowserLanguages(["fr-FR"]);
    expect(detectLocale()).toBe("en-US");
  });

  it("非法 URL 参数被忽略", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    window.history.replaceState({}, "", "/?lang=fr");
    expect(detectLocale()).toBe("zh-CN");
  });
});

describe("setLocale", () => {
  it("即时切换、写入 localStorage、同步 html lang，并清除 URL 覆盖", async () => {
    window.history.replaceState({}, "", "/?lang=zh-CN&foo=1");
    await setLocale("en-US");

    expect(i18n.language).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.location.search).toBe("?foo=1");
  });
});
