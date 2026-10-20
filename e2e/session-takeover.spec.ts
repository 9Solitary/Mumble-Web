import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// 同名会话终止态：
// - 被顶号后前端停在终止页，不自动重连；
// - “重新进入”可以反向接管；
// - 两个页面不会互相无限重连。

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

test("被顶号后停在终止页，不自动重连；重新进入可反向接管", async ({ page }) => {
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

test("两个页面同名：后进者接管，先进入者停止重连", async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await mockMedia(pageA);
  await mockMedia(pageB);

  let active: "a" | "b" | null = null;
  const sockets: Partial<Record<"a" | "b", WebSocketRoute>> = {};
  const connects: Record<"a" | "b", number> = { a: 0, b: 0 };

  const setup = (page: Page, key: "a" | "b") => {
    page.routeWebSocket("**/ws", (ws) => {
      connects[key]++;
      sockets[key] = ws;
      ws.send(HELLO(`page-${key}-${connects[key]}`));
      ws.onMessage((raw) => {
        const env = JSON.parse(String(raw));
        if (env.type !== "connect") return;

        // 新登录顶掉当前 active
        if (active && active !== key) {
          const prev = sockets[active];
          prev?.send(
            JSON.stringify({
              type: "disconnected",
              reason: "another session signed in with this name",
              code: "session_takeover",
            }),
          );
          prev?.close({ code: 4001, reason: "session takeover" });
        }
        active = key;
        loginSequence(ws, env.username ?? key);
      });
    });
  };

  setup(pageA, "a");
  setup(pageB, "b");

  await enter(pageA, "同名两人");
  await expect(pageA.getByTestId("messages")).toBeVisible({ timeout: 10_000 });
  expect(active).toBe("a");

  await enter(pageB, "同名两人");
  await expect(pageB.getByTestId("messages")).toBeVisible({ timeout: 10_000 });
  expect(active).toBe("b");

  await expect(pageA.getByText("这个昵称在另一处登录了")).toBeVisible();
  await pageA.waitForTimeout(1500);
  expect(connects.a, "被顶页面不应自动重连").toBe(1);

  // A 重新进入，反向接管 B
  await pageA.getByRole("button", { name: "重新进入" }).click();
  await expect(pageA.getByTestId("messages")).toBeVisible({ timeout: 10_000 });
  expect(active).toBe("a");
  await expect(pageB.getByText("这个昵称在另一处登录了")).toBeVisible();
  expect(connects.a).toBe(2);

  await context.close();
});
