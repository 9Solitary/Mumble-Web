import { expect, test, type Page } from "@playwright/test";
import { enterApp, installMockMedia } from "./helpers";

interface MessageFixture {
  sender: number;
  senderName: string;
  message: string;
  time: number;
}

async function mockChat(page: Page, messages: MessageFixture[]) {
  await installMockMedia(page);
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-chat-redesign",
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
      for (const message of messages) {
        ws.send(
          JSON.stringify({
            type: "textMessage",
            text: {
              sender: message.sender,
              senderName: message.senderName,
              channelIds: [0],
              message: message.message,
              time: message.time,
            },
          }),
        );
      }
      ws.send(JSON.stringify({ type: "synced" }));
    });
  });

  await page.goto("/");
  await page.getByTestId("connect-username").fill("聊天测试");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();
}

test("聊天：分组、日期分隔、系统消息、链接与复制", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 800 });

  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;
  await mockChat(page, [
    {
      sender: 2,
      senderName: "阿澈",
      message: "前天的消息 https://example.com/old",
      time: now - 2 * day,
    },
    {
      sender: 2,
      senderName: "阿澈",
      message: "昨天的消息 https://example.com/yesterday",
      time: now - day,
    },
    {
      sender: 2,
      senderName: "阿澈",
      message: "今晚延迟很低 https://example.com/docs?q=1 。",
      time: now - 180,
    },
    { sender: 2, senderName: "阿澈", message: "连续第二条", time: now - 120 },
    { sender: 2, senderName: "阿澈", message: "连续第三条", time: now - 60 },
    {
      sender: 3,
      senderName: "小满",
      message: "另一个人的消息",
      time: now - 30,
    },
    {
      sender: 0,
      senderName: "服务器",
      message: "服务器：欢迎来到闲聊",
      time: now - 20,
    },
  ]);

  // 三天 -> 三个日期分隔
  await expect(page.getByTestId("date-divider")).toHaveCount(3);
  await expect(page.getByText("今天", { exact: true })).toBeVisible();
  await expect(page.getByText("昨天", { exact: true })).toBeVisible();

  // 同一发送者 5 分钟内只显示一次作者；跨日/换人重新显示
  await expect(page.getByTestId("message-author")).toHaveCount(4);
  await expect(page.getByTestId("message-row")).toHaveCount(6);
  await expect(page.getByTestId("system-message")).toContainText(
    "服务器：欢迎来到闲聊",
  );

  // 链接可点、新窗口打开且安全
  const link = page.getByRole("link", { name: "https://example.com/docs?q=1" });
  await expect(link).toHaveAttribute("href", "https://example.com/docs?q=1");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // 悬浮复制
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "今晚延迟很低" })
    .first();
  await row.hover();
  await row.getByTestId("message-copy").click();
  await expect(row.locator("svg.lucide-check")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("今晚延迟很低 https://example.com/docs?q=1 。");
});

test("空态：查看未加入频道可加入并开始发言", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  await page.getByTestId("channel-1").click();
  await expect(page.getByTestId("chat-header")).toContainText("闲聊");
  await expect(page.getByText("欢迎来到 闲聊")).toBeVisible();
  await expect(page.getByTestId("chat-join-empty")).toBeVisible();
  await expect(page.getByTestId("composer-input")).toBeDisabled();
  await expect(page.getByTestId("composer-input")).toHaveAttribute(
    "placeholder",
    /闲聊/,
  );

  await page.getByTestId("chat-join-channel").click();
  await expect(page.getByTestId("composer-input")).toBeEnabled();
  await expect(page.getByTestId("composer-input")).toHaveAttribute(
    "placeholder",
    "发消息到 闲聊",
  );

  const input = page.getByTestId("composer-input");
  await input.fill("加入后发一条");
  await input.press("Enter");
  await expect(page.getByTestId("messages")).toContainText("加入后发一条");
});

test("输入区：拖入图片即可发送", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAG0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAB4G4YAAAFQ6ZqPAAAAAElFTkSuQmCC",
    "base64",
  );
  const dataTransfer = await page.evaluateHandle((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "drop.png", { type: "image/png" }));
    return transfer;
  }, png.toString("base64"));

  await page.getByTestId("composer").dispatchEvent("drop", { dataTransfer });
  await expect(page.getByRole("button", { name: "查看大图" })).toBeVisible({
    timeout: 10_000,
  });
});
