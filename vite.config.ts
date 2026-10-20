/// <reference types="vitest/config" />
import { readFileSync } from "node:fs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string }

// React / Radix 等基础依赖单独成块：入口 chunk 更小，且它们很少随业务变化。
// 其余依赖留在入口，避免 vendor 与 react 互相引用形成循环 chunk。
function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  if (!normalized.includes("node_modules")) return undefined;
  if (
    normalized.includes("/react/") ||
    normalized.includes("/react-dom/") ||
    normalized.includes("/scheduler/")
  ) {
    return "react";
  }
  if (normalized.includes("/@radix-ui/")) return "radix";
  if (normalized.includes("/lucide-react/")) return "icons";
  return undefined;
}

// Vite 以站点根路径发布：SPA 嵌套路由（如 /invite/<token>）必须使用绝对
// asset URL，否则浏览器会把 ./assets 解析成 /invite/assets，nginx 的 SPA
// 回退又会把 index.html 当 JS/CSS 返回，最终白屏/黑屏。当前部署不支持子路径；
// 若未来支持，需要同时配置 Router basename 与这里的 base。
export default defineConfig({
  base: "/",
  plugins: [inspectAttr(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    rollupOptions: {
      output: { manualChunks },
    },
  },
  server: {
    port: 3000,
    // 编辑器写入时会短暂创建 .xxx.tmpdir；Windows 下 watcher 可能因 EBUSY 崩溃
    watch: {
      ignored: ["**/.*tmpdir/**", "**/.tmp/**"],
    },
    proxy: {
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"], // e2e/ 归 Playwright 管
  },
});
