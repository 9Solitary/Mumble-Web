import { expect, test, type Page } from "@playwright/test";

// 聊天布局与图片查看器回归：
// - 超长英文/中文不得把消息列撑出聊天窗；
// - 图片缩略图可点击打开 Lightbox，Esc 关闭。

async function mockMedia(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  });
}

async function mockBackend(page: Page) {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-chat",
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
      if (env.type === "connect") {
        ws.send(
          JSON.stringify({
            type: "connected",
            self: { session: 1, name: "聊天测试", channelId: 0 },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "channel",
            channel: {
              id: 0,
              parentId: -1,
              name: "闲聊",
              description: "测试频道",
              position: 0,
              temporary: false,
            },
          }),
        );
        ws.send(
          JSON.stringify({
            type: "config",
            config: { maxMessageLength: 5000, maxImageMessageLength: 131072 },
          }),
        );
        ws.send(JSON.stringify({ type: "synced" }));
      }
      if (env.type === "sendText") {
        ws.send(
          JSON.stringify({
            type: "textMessage",
            text: {
              sender: 1,
              senderName: "聊天测试",
              channelIds: [0],
              message: env.message,
              time: Math.floor(Date.now() / 1000),
            },
          }),
        );
      }
    });
  });
}

async function enter(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("聊天测试");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();
  return page.getByTestId("composer-input");
}

test("超长消息不出框、不产生横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockMedia(page);
  await mockBackend(page);
  const input = await enter(page);

  await input.fill("A".repeat(300));
  await input.press("Enter");
  await page.waitForTimeout(200);
  await input.fill("这是一段很长的中文消息，用来测试文字频道里文字是否会冲出消息框。".repeat(8));
  await input.press("Enter");
  await page.waitForTimeout(300);

  const metrics = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="messages"]') as HTMLElement;
    const texts = [...document.querySelectorAll(".break-words")];
    const last = texts[texts.length - 1] as HTMLElement;
    return {
      scrollWidth: scroll.scrollWidth,
      clientWidth: scroll.clientWidth,
      textScroll: last.scrollWidth,
      textClient: last.clientWidth,
      bodyScroll: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });

  expect(metrics.scrollWidth, "消息容器出现横向滚动").toBeLessThanOrEqual(
    metrics.clientWidth + 1,
  );
  expect(metrics.textScroll, "文本仍被撑宽").toBeLessThanOrEqual(
    metrics.textClient + 1,
  );
  expect(metrics.bodyScroll, "页面出现横向滚动").toBeLessThanOrEqual(
    metrics.innerWidth + 1,
  );
});

test("图片点击打开查看器，Esc 关闭", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockMedia(page);
  await mockBackend(page);
  await enter(page);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAG0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAB4G4YAAAFQ6ZqPAAAAAElFTkSuQmCC",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: png,
  });

  const thumb = page.getByRole("button", { name: "查看大图" }).last();
  await expect(thumb).toBeVisible({ timeout: 10_000 });
  await thumb.click();

  const dialog = page.getByRole("dialog", { name: "图片查看器" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "下载图片" })).toBeVisible();

  // 小图打开时应自动放大（100×100 测试图至少放大到 200px 以上）
  const image = dialog.getByRole("img", { name: "图片查看器" });
  await expect
    .poll(async () => (await image.boundingBox())?.width ?? 0)
    .toBeGreaterThan(200);

  // 滚轮可继续放大
  const before = (await image.boundingBox())!.width;
  await image.hover();
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => (await image.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
