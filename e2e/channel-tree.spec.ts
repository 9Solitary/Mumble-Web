import { expect, test } from "@playwright/test";
import { enterApp, installMockMedia } from "./helpers";

function noHorizontalScroll(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test("频道树：真实折叠、单击查看、悬浮/双击加入", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  const sidebar = page.getByTestId("channel-sidebar");
  const nested = sidebar.getByTestId("channel-3");
  const nestedUser = sidebar.getByTestId("channel-user-4");
  await expect(nested).toBeVisible();
  await expect(nestedUser).toBeVisible();

  // 折叠父频道：子频道与在麦用户一起隐藏
  const toggle = sidebar.getByTestId("channel-toggle-2");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nested).toBeHidden();
  await expect(nestedUser).toBeHidden();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("mumble-web.collapsedChannels"),
    ),
  ).toContain("2");

  await toggle.click();
  await expect(nested).toBeVisible();

  // 根频道折叠会收起全部一级频道
  const rootToggle = sidebar.getByTestId("channel-toggle-0");
  await rootToggle.click();
  await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.getByTestId("channel-1")).toBeHidden();
  await rootToggle.click();
  await expect(sidebar.getByTestId("channel-1")).toBeVisible();

  // 单击只切换聊天视图，不改变自己所在的语音频道
  await sidebar.getByTestId("channel-2").click();
  await expect(page.getByTestId("chat-header")).toContainText("开黑房");
  await expect(sidebar.getByTestId("channel-2")).toHaveAttribute(
    "data-viewed",
    "true",
  );
  await expect(sidebar.getByTestId("channel-0")).toHaveAttribute(
    "data-joined",
    "true",
  );
  await expect(page.getByTestId("composer-input")).toBeDisabled();
  await expect(page.getByTestId("composer-input")).toHaveAttribute(
    "placeholder",
    /开黑房/,
  );
  await expect(page.getByTestId("chat-join-channel")).toBeVisible();

  // 悬浮“加入语音”直接进频道
  await sidebar.getByTestId("channel-1").hover();
  const join = sidebar.getByTestId("channel-join-1");
  await expect(join).toBeVisible();
  await join.click();
  await expect(sidebar.getByTestId("channel-1")).toHaveAttribute(
    "data-joined",
    "true",
  );
  await expect(page.getByTestId("composer-input")).toBeEnabled();
  await expect(page.getByTestId("composer-input")).toHaveAttribute(
    "placeholder",
    /闲聊/,
  );

  // 双击也能进语音
  await sidebar.getByTestId("channel-2").dblclick();
  await expect(sidebar.getByTestId("channel-2")).toHaveAttribute(
    "data-joined",
    "true",
  );
  await expect(page.getByTestId("chat-header")).toContainText("开黑房");
  await expect(page.getByTestId("composer-input")).toBeEnabled();

  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test("未读点：查看别的频道时出现，点回该频道后清除", async ({ page }) => {
  await installMockMedia(page);
  let sendEnvelope: ((payload: unknown) => void) | null = null;

  await page.routeWebSocket("**/ws", (ws) => {
    sendEnvelope = (payload) => ws.send(JSON.stringify(payload));
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-unread",
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
          self: { session: 1, name: "未读测试", channelId: 0 },
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
    });
  });

  await page.goto("/");
  await page.getByTestId("connect-username").fill("未读测试");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();

  // 查看“闲聊”，但自己仍在根频道；根频道收到新消息
  await page.getByTestId("channel-1").click();
  await expect(page.getByTestId("chat-header")).toContainText("闲聊");
  await expect(page.getByTestId("channel-unread-0")).toHaveCount(0);

  sendEnvelope?.({
    type: "textMessage",
    text: {
      sender: 2,
      senderName: "机器人小助手",
      channelIds: [0],
      message: "大厅有新消息",
      time: Math.floor(Date.now() / 1000),
    },
  });
  await expect(page.getByTestId("channel-unread-0")).toBeVisible();

  await page.getByTestId("channel-0").click();
  await expect(page.getByTestId("chat-header")).toContainText("根频道");
  await expect(page.getByTestId("channel-unread-0")).toHaveCount(0);
  await expect(page.getByTestId("messages")).toContainText("大厅有新消息");
});

test("390px 频道抽屉：单击查看聊天，加入主按钮仍可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterApp(page);

  await page.getByRole("button", { name: "频道" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  const drawer = page.getByTestId("channel-sidebar-drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("drawer-channel-2").click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("chat-header")).toContainText("开黑房");
  await expect(page.getByTestId("composer-input")).toBeDisabled();

  await page.getByRole("button", { name: "频道" }).click();
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  await sheet.getByTestId("drawer-channel-1").click();
  await sheet.getByRole("button", { name: "加入频道" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("chat-header")).toContainText("闲聊");
  await expect(page.getByTestId("composer-input")).toBeEnabled();

  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});
