import { expect, test, type Page } from "@playwright/test";
import { mockProxy } from "./helpers";

// WebKit 的 headless AudioContext 与 Chromium 行为不同；跨浏览器冒烟只验证
// 连接、布局、设置与抽屉，不注入假麦克风，也不把语音链路作为门禁。
async function enterUi(page: Page, name: string) {
  await mockProxy(page);
  await page.goto("/");
  await page.getByTestId("connect-username").fill(name);
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();
}

function horizontalOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test("连接页：英文 320px 无横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?lang=en");
  await expect(page.getByTestId("connect-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect to your voice space" }),
  ).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("主界面与设置六个 Tab 可用", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterUi(page, "Cross browser");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("voice-panel")).toBeVisible();
  await expect(page.getByTestId("messages")).toBeVisible();
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const name of ["音频", "语音", "快捷键", "外观", "诊断", "关于"]) {
    await dialog.getByRole("tab", { name }).click();
    await expect(dialog.getByRole("tab", { name })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await dialog.getByTestId("settings-done").click();
  await expect(dialog).toBeHidden();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("390px：语音坞、频道抽屉与输入框可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterUi(page, "Cross mobile");

  await expect(page.getByTestId("voice-dock")).toBeVisible();
  const composer = await page.getByTestId("composer-input").boundingBox();
  expect(composer?.width).toBeGreaterThan(180);

  await page.getByRole("button", { name: "频道" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("会话结束页可见", async ({ page }) => {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-cross-ended",
        version: "e2e",
        server: {
          address: "mock:64738",
          resolved: "127.0.0.1:64738",
          tlsMode: "insecure",
          voice: "tcp-tunnel",
        },
      }),
    );
    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      if (env.type !== "connect") return;
      ws.send(
        JSON.stringify({
          type: "reject",
          code: "session_takeover",
          reason: "Signed in elsewhere",
        }),
      );
    });
  });

  await page.goto("/");
  await page.getByTestId("connect-username").fill("Cross ended");
  await page.getByTestId("connect-submit").click();
  await expect(
    page.getByRole("heading", { name: "这个昵称在另一处登录了" }),
  ).toBeVisible();
  await expect(page.getByTestId("session-retry")).toBeVisible();
});
