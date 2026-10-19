import { expect, test, type Page } from "@playwright/test";

// 断线自动重连回归：routeWebSocket 模拟代理，登录进入主界面后由服务端
// 主动以 1011 断开 WS，断言前端出现重连提示并自动发起新连接、重放 connect。

// 与 layout-overflow.spec.ts 相同的媒体设备 mock，避免权限弹窗
async function mockMediaDevices(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  });
}

interface ConnRecord {
  connectEnv: Record<string, unknown> | null;
  ready: Promise<void>;
  markReady: () => void;
}

test("WS 异常断开后自动重连并重放 connect", async ({ page }) => {
  await mockMediaDevices(page);

  const conns: ConnRecord[] = [];
  let firstWs: import("@playwright/test").WebSocketRoute | null = null;

  await page.routeWebSocket("**/ws", (ws) => {
    const idx = conns.length;
    let markReady!: () => void;
    const rec: ConnRecord = {
      connectEnv: null,
      ready: new Promise<void>((r) => (markReady = r)),
      markReady,
    };
    conns.push(rec);
    if (idx === 0) firstWs = ws;

    ws.send(
      JSON.stringify({
        type: "hello",
        sid: `e2e-sid-${idx}`,
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
      rec.connectEnv = env;
      ws.send(
        JSON.stringify({
          type: "connected",
          self: { session: 1, name: env.username ?? "测试用户", channelId: 0 },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "channel",
          channel: {
            id: 0,
            parentId: -1,
            name: "根频道",
            description: "",
            position: 0,
            temporary: false,
          },
        }),
      );
      ws.send(JSON.stringify({ type: "synced" }));
      rec.markReady();
    });
  });

  // 登录进入主界面
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("重连测试用户");
  await page.getByTestId("connect-submit").click();
  await expect(page.locator("button:has(svg.lucide-settings):visible")).toBeVisible();
  await conns[0].ready;

  // 服务端以 1011 异常断开（契约 4：上游 Mumble 断开）
  firstWs!.close({ code: 1011, reason: "upstream lost" });

  // 出现重连提示条
  const banner = page.getByText(/连接已断开，正在重连/);
  await expect(banner).toBeVisible();

  // 自动发起新 WS 并重放 connect（带已保存凭据）
  await expect
    .poll(() => conns.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await conns[1].ready;
  expect(conns[1].connectEnv).toMatchObject({
    type: "connect",
    username: "重连测试用户",
    password: "",
  });

  // 重连成功后提示条消失，回到主界面
  await expect(banner).toBeHidden();
  await expect(page.locator("button:has(svg.lucide-settings):visible")).toBeVisible();
});
