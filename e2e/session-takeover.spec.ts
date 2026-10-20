import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// 同名冲突与终止态：
// - 不同标签页同名：后进者被拒绝并提示换昵称，先进入者保持在线；
// - 同一标签页重连收到 session_takeover：停在终止页，不自动重连。

async function mockMedia(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  });
}

const HELLO = (sid: string) =>
  JSON.stringify({
    type: "hello",
    sid,
    version: "e2e",
    server: {
      address: "mock:64738",
      resolved: "127.0.0.1:64738",
      tlsMode: "insecure",
      voice: "tcp-tunnel",
    },
  });

function loginSequence(ws: WebSocketRoute, username: string) {
  ws.send(
    JSON.stringify({
      type: "connected",
      self: { session: 1, name: username, channelId: 0 },
    }),
  );
  ws.send(
    JSON.stringify({
      type: "channel",
      channel: {
        id: 0,
        parentId: -1,
        name: "闲聊",
        description: "",
        position: 0,
        temporary: false,
      },
    }),
  );
  ws.send(JSON.stringify({ type: "synced" }));
}

async function enter(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel(/用户名/).fill(name);
  await page.getByTestId("connect-submit").click();
}

test("收到 session_takeover：停在终止页，不自动重连；重新进入可恢复", async ({ page }) => {
  await mockMedia(page);
  let connects = 0;
  let kicked = false;

  await page.routeWebSocket("**/ws", (ws) => {
    connects++;
    ws.send(HELLO(`takeover-${connects}`));
    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      if (env.type !== "connect") return;
      loginSequence(ws, env.username ?? "用户");
      if (!kicked) {
        kicked = true;
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: "disconnected",
              reason: "another session signed in with this name",
              code: "session_takeover",
            }),
          );
          ws.close({ code: 4001, reason: "session takeover" });
        }, 250);
      }
    });
  });

  await enter(page, "同名用户");
  await expect(page.getByText("这个昵称在另一处登录了")).toBeVisible({
    timeout: 10_000,
  });
  const ended = page.getByTestId("session-ended");
  await expect(ended).toContainText("这个页面不会自动重连");
  await expect(ended).toContainText("同名用户");
  await expect(ended).toContainText("mock:64738");
  await expect(page.getByRole("button", { name: "重新进入" })).toBeVisible();

  await page.waitForTimeout(1500);
  expect(connects, "终止后不应自动重连").toBe(1);

  // 重新进入：第二次连接不再被顶，回到主界面
  await page.getByRole("button", { name: "重新进入" }).click();
  await expect(page.getByTestId("messages")).toBeVisible({ timeout: 10_000 });
  expect(connects).toBe(2);
});

test("两个页面同名：后进者被拒绝并提示换昵称，先进入者保持在线", async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await mockMedia(pageA);
  await mockMedia(pageB);

  let aOnline = false;
  let connectsA = 0;
  let connectsB = 0;

  pageA.routeWebSocket("**/ws", (ws) => {
    connectsA++;
    ws.send(HELLO(`page-a-${connectsA}`));
    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      if (env.type !== "connect") return;
      aOnline = true;
      loginSequence(ws, env.username ?? "同名两人");
    });
  });

  pageB.routeWebSocket("**/ws", (ws) => {
    connectsB++;
    ws.send(HELLO(`page-b-${connectsB}`));
    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      if (env.type !== "connect") return;
      if (aOnline) {
        // 新策略：同名在线时不接管旧会话，直接拒绝新登录。
        ws.send(
          JSON.stringify({
            type: "reject",
            code: "username_in_use",
            reason: "这个昵称已被占用",
          }),
        );
        return;
      }
      aOnline = true;
      loginSequence(ws, env.username ?? "同名两人");
    });
  });

  await enter(pageA, "同名两人");
  await expect(pageA.getByTestId("messages")).toBeVisible({ timeout: 10_000 });
  expect(aOnline).toBe(true);

  await enter(pageB, "同名两人");
  await expect(
    pageB.getByRole("heading", { name: "这个昵称已经被占用" }),
  ).toBeVisible({ timeout: 10_000 });
  const endedB = pageB.getByTestId("session-ended");
  await expect(endedB).toContainText("另一个客户端");
  await expect(endedB.getByTestId("session-change-name")).toBeVisible();
  await expect(endedB.getByTestId("session-retry")).toHaveCount(0);

  await pageB.waitForTimeout(1500);
  expect(connectsB, "被拒绝页面不应自动重连").toBe(1);
  expect(connectsA, "先进入页面不应被顶").toBe(1);
  await expect(pageA.getByTestId("messages")).toBeVisible();
  await expect(pageA.getByTestId("connection-pill")).toContainText("已连接");

  await context.close();
});
