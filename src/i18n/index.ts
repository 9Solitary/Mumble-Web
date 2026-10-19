import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";

// 语言标识与存储键：URL ?lang= 只用于测试/分享，不写回本地。
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_STORAGE_KEY = "mumble-web.locale";

// 接受 en / en-US / zh / zh-Hans / zh_CN 等写法，统一落到两套资源。
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase().replace(/_/g, "-");
  if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
  if (tag === "en" || tag.startsWith("en-")) return "en-US";
  return null;
}

// 语言检测优先级：?lang= → localStorage → 浏览器语言 → en-US。
export function detectLocale(): Locale {
  if (typeof window === "undefined") return "en-US";

  const fromUrl = normalizeLocale(
    new URLSearchParams(window.location.search).get("lang"),
  );
  if (fromUrl) return fromUrl;

  try {
    const saved = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    /* 隐私模式下忽略 */
  }

  if (typeof navigator !== "undefined") {
    const languages = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const language of languages) {
      const normalized = normalizeLocale(language);
      if (normalized) return normalized;
    }
  }
  return "en-US";
}

const initialLocale = detectLocale();

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: initialLocale,
  fallbackLng: "en-US",
  supportedLngs: [...SUPPORTED_LOCALES],
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

function applyDocumentLang(locale: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = "ltr";
}

applyDocumentLang(i18n.language);

i18n.on("languageChanged", (locale) => {
  applyDocumentLang(locale);
});

// 切换语言：即时生效并持久化。?lang= 只作一次性覆盖，
// 用户显式切换后把 lang 从 URL 移除，避免刷新又被 URL 拉回去。
export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 隐私模式下忽略 */
  }

  const url = new URL(window.location.href);
  if (url.searchParams.has("lang")) {
    url.searchParams.delete("lang");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
}

export default i18n;
