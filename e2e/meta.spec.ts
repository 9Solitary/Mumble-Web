import { expect, test } from "@playwright/test";
import { enterApp, installMockMedia } from "./helpers";

test("index.html 带 favicon、manifest、theme-color 和描述", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('html[lang="zh-CN"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][sizes="16x16"]')).toHaveAttribute(
    "href",
    "/favicon-16.png?v=3",
  );
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
    "href",
    "/favicon-32.png?v=3",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/site.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png?v=3",
  );
  await expect(page.locator('link[rel="mask-icon"]')).toHaveAttribute(
    "href",
    "/brand/mark-mono.svg?v=3",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/public\/og-cover\.png$/,
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
    "content",
    "1200",
  );
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
    "content",
    "630",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    /\/public\/og-cover\.png$/,
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
  const maskable = json.icons.find((icon: { purpose?: string }) =>
    String(icon.purpose ?? "").includes("maskable"),
  );
  expect(maskable?.src).toBe("./icon-maskable-512.png?v=3");
  expect(
    json.icons.some(
      (icon: { sizes?: string; purpose?: string }) =>
        icon.sizes === "192x192" && icon.purpose === "any",
    ),
  ).toBeTruthy();

  for (const icon of json.icons) {
    const res = await request.get(icon.src.replace("./", "/"));
    expect(res.ok(), `${icon.src} 不可访问`).toBeTruthy();
  }

  const maskIcon = await request.get("/brand/mark-mono.svg");
  expect(maskIcon.ok()).toBeTruthy();
  const maskText = await maskIcon.text();
  expect(maskText).toContain("瑕疵版");
  expect(maskText).toContain("#E9F1F8");

  for (const icon of ["/favicon-16.png", "/favicon-32.png", "/favicon.ico"]) {
    const res = await request.get(icon);
    expect(res.ok(), `${icon} 不可访问`).toBeTruthy();
  }

  const imageSizes = await page.evaluate(async (sources) => {
    const out: Record<string, { w: number; h: number }> = {};
    for (const [key, src] of Object.entries(sources)) {
      const image = new Image();
      image.src = src;
      await image.decode();
      out[key] = { w: image.naturalWidth, h: image.naturalHeight };
    }
    return out;
  }, {
    favicon16: "/favicon-16.png",
    favicon32: "/favicon-32.png",
    icon192: "/icon-192.png",
    apple: "/apple-touch-icon.png",
    maskable: "/icon-maskable-512.png",
    og: "/og-cover.png",
  });
  expect(imageSizes).toEqual({
    favicon16: { w: 16, h: 16 },
    favicon32: { w: 32, h: 32 },
    icon192: { w: 192, h: 192 },
    apple: { w: 180, h: 180 },
    maskable: { w: 512, h: 512 },
    og: { w: 1200, h: 630 },
  });
});

test("标题跟随频道变化", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "标题测试");
  await expect(page).toHaveTitle("根频道 · Mumble Web");
});

test("标题未读：其他频道来消息显示 (1)，点进频道后清除", async ({ page }) => {
  await installMockMedia(page);
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-unread-title",
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
          type: "connected",
          self: { session: 1, name: "标题未读", channelId: 0 },
        }),
      );
      for (const channel of [
        { id: 0, parentId: -1, name: "根频道", description: "", position: 0, temporary: false },
        { id: 1, parentId: 0, name: "闲聊", description: "", position: 1, temporary: false },
      ]) {
        ws.send(JSON.stringify({ type: "channel", channel }));
      }
      ws.send(
        JSON.stringify({
          type: "config",
          config: { maxMessageLength: 5000, maxImageMessageLength: 131072 },
        }),
      );
      ws.send(JSON.stringify({ type: "synced" }));
      setTimeout(() => {
        ws.send(
          JSON.stringify({
            type: "textMessage",
            text: {
              sender: 2,
              senderName: "机器人小助手",
              channelIds: [1],
              message: "来一条未读消息",
              time: Math.floor(Date.now() / 1000),
            },
          }),
        );
      }, 120);
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("connect-username").fill("标题未读");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();
  await expect(page).toHaveTitle("(1) 根频道 · Mumble Web");

  await page.getByTestId("channel-1").click();
  await expect(page).toHaveTitle("闲聊 · Mumble Web");
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
