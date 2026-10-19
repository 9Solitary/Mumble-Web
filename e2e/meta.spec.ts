import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

test("index.html 带 favicon、manifest、theme-color 和描述", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('html[lang="zh-CN"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
    "href",
    "./favicon.svg",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "./site.webmanifest",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#080D12",
  );
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
    "content",
    "dark",
  );
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(description?.length ?? 0).toBeGreaterThan(20);
  await expect(page).toHaveTitle("Mumble Web");

  const manifest = await request.get("/site.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  const json = await manifest.json();
  expect(json.name).toBe("Mumble Web");
  expect(json.theme_color).toBe("#080D12");
  expect(json.icons.length).toBeGreaterThanOrEqual(3);

  for (const icon of json.icons) {
    const res = await request.get(icon.src.replace("./", "/"));
    expect(res.ok(), `${icon.src} 不可访问`).toBeTruthy();
  }

  const sizes = await page.evaluate(async () => {
    const image = new Image();
    image.src = "./icon-192.png";
    await image.decode();
    return { w: image.naturalWidth, h: image.naturalHeight };
  });
  expect(sizes).toEqual({ w: 192, h: 192 });
});

test("标题跟随频道变化", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "标题测试");
  await expect(page).toHaveTitle("根频道 · Mumble Web");
});

test("会话终止时标题变为“会话已结束”", async ({ page }) => {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-title",
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
  await page.getByLabel(/用户名/).fill("标题测试");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByText("这个昵称在另一处登录了")).toBeVisible();
  await expect(page).toHaveTitle("会话已结束 · Mumble Web");
});
