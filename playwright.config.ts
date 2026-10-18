import { defineConfig, devices } from "@playwright/test";

// 最小 e2e 框架：webServer 自动拉起 Vite dev server（端口 3000）。
// 回归测试套件在阶段 1 补充，当前仅 smoke。
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
