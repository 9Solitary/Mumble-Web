import { expect, test } from "@playwright/test";

function mockServerAddress(page: import("@playwright/test").Page) {
  return page.route("**/api/server", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ resolved: "mock:64738", address: "mock:64738" }),
    }),
  );
}

async function connectWithReject(page: import("@playwright/test").Page) {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-connect",
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
          code: "server_password",
          reason: "Incorrect server password",
        }),
      );
    });
  });
}

test("连接页：服务器预填后折叠，1024×576 一屏放下", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await mockServerAddress(page);
  await page.goto("/");
  await expect(page.getByTestId("connect-submit")).toBeVisible();
  await page.waitForTimeout(300);

  await expect(page.locator("details")).not.toHaveAttribute("open", "");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(576);
});

test("连接页：320px 无横向滚动，表单可填可提交", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockServerAddress(page);
  await page.goto("/");
  await page.waitForTimeout(300);

  const card = await page.getByTestId("connect-card").boundingBox();
  expect(card?.x).toBeGreaterThanOrEqual(0);
  expect((card?.x ?? 0) + (card?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await page.getByLabel(/用户名/).fill("连接页测试");
  await expect(page.getByTestId("connect-submit")).toBeEnabled();
});

test("连接失败：显示本地化摘要与可展开原始详情", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithReject(page);
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("错误测试");
  await page.getByTestId("connect-submit").click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("服务器密码不正确");
  await alert.getByText("详情").click();
  await expect(alert).toContainText("Incorrect server password");
});

test("邀请模式：只显示用户名，不显示服务器和密码", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/invites/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ valid: true }),
    }),
  );
  await page.goto("/invite/test-token");

  await expect(page.getByRole("heading", { name: "通过邀请加入" })).toBeVisible();
  await expect(page.getByLabel(/用户名/)).toBeVisible();
  await expect(page.getByLabel(/服务器密码/)).toHaveCount(0);
  await expect(page.getByLabel("地址")).toHaveCount(0);
  await expect(page.getByLabel("端口")).toHaveCount(0);
});
