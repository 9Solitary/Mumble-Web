// 构建时注入的 Web 版本；单测/非 Vite 环境下回退为 dev。
export const APP_VERSION =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__
    ? __APP_VERSION__
    : "dev";
