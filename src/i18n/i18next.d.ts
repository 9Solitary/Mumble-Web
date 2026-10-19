import "i18next";
import type zh from "./locales/zh-CN.json";

// 用中文资源作为 key 的唯一来源：t("…") 写错 key 会在编译期报错。
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof zh;
    };
  }
}
