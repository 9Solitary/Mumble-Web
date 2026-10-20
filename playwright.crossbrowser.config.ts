import { defineConfig, devices } from "@playwright/test";

// 跨浏览器冒烟：只跑 UI/布局/设置关键路径，不把 WebRTC 语音作为自动化门禁。
// 用法：npm run test:e2e:cross
export default defineConfig({
  testDir: "e2e",
  testMatch: /cross-browser\.spec\.ts/,
  timeout: 45_000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    locale: "zh-CN",
  },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
