import { expect, test, type Page } from "@playwright/test";

// UI 出框回归：长设备名 / 超长用户名 / 小屏定宽。
// 通过 routeWebSocket 模拟代理协议（hello → connected → channel/user/config → synced），
// 不依赖真实后端即可进入主界面；addInitScript mock 媒体设备，避免权限弹窗。

// 100+ 字符的设备名（旧缺陷的触发条件：弹层宽度随最长选项膨胀）
const LONG_LABEL =
  "超长名称虚拟音频设备 SuperUltraLongBrand Model X-2000 Pro Max 环绕声阵列麦克风 ".repeat(
    2,
  );

interface MockDevice {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

const MOCK_DEVICES: MockDevice[] = [
  { deviceId: "in-1", kind: "audioinput", label: LONG_LABEL + "（输入一）", groupId: "g1" },
  { deviceId: "in-2", kind: "audioinput", label: LONG_LABEL + "（输入二）", groupId: "g2" },
  { deviceId: "in-3", kind: "audioinput", label: "普通麦克风", groupId: "g3" },
  { deviceId: "out-1", kind: "audiooutput", label: LONG_LABEL + "（输出一）", groupId: "g4" },
  { deviceId: "out-2", kind: "audiooutput", label: LONG_LABEL + "（输出二）", groupId: "g5" },
];

// 在进入页面前装好媒体设备 mock（设置弹窗会枚举设备，登录会调 getUserMedia）
async function mockMediaDevices(page: Page) {
  await page.addInitScript((devices: MockDevice[]) => {
    navigator.mediaDevices.enumerateDevices = async () =>
      devices as unknown as MediaDeviceInfo[];
    // 用 AudioContext 目的地的静音轨冒充麦克风，走通 WebRTC 建链流程
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  }, MOCK_DEVICES);
}

// 拦截 /ws：不回连真实后端，收到 connect 后直接回放登录成功序列
async function mockBackend(page: Page) {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-sid",
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
      const name: string = env.username ?? "测试用户";
      ws.send(
        JSON.stringify({
          type: "connected",
          self: { session: 1, name, channelId: 0, maxMessageLength: 5000 },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "channel",
          channel: {
            id: 0,
            parentId: -1,
            name: "根频道",
            description: "测试频道描述",
            position: 0,
            temporary: false,
          },
        }),
      );
      ws.send(
        JSON.stringify({
          type: "user",
          user: {
            session: 1,
            name,
            channelId: 0,
            muted: false,
            deafened: false,
            suppressed: false,
            selfMuted: false,
            selfDeafened: false,
            prioritySpeaker: false,
            registered: false,
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
    });
  });
}

// 登录并进入主界面，返回设置按钮定位器
async function enterMainUI(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("布局测试用户");
  await page.getByRole("button", { name: "连 接" }).click();
  const settingsBtn = page.locator("button:has(svg.lucide-settings)");
  await expect(settingsBtn).toBeVisible();
  return settingsBtn;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 元素矩形必须落在容器/视口内（留 1px 抗动画抖动余量）
function expectInside(inner: Rect, outer: Rect, what: string) {
  expect(inner.x, `${what} 左缘越界`).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width, `${what} 右缘越界`).toBeLessThanOrEqual(
    outer.x + outer.width + 1,
  );
}

for (const width of [320, 375, 1280]) {
  test(`设置弹窗：长设备名不出框（视口 ${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockMediaDevices(page);
    await mockBackend(page);
    const settingsBtn = await enterMainUI(page);

    // UserBar 五个按钮不裁切（离开语音按钮不越出工具条）
    const userbar = settingsBtn.locator("..");
    const ubRect = await userbar.boundingBox();
    const leaveRect = await page
      .locator("button:has(svg.lucide-phone-off)")
      .boundingBox();
    expect(ubRect).not.toBeNull();
    expect(leaveRect).not.toBeNull();
    expectInside(leaveRect!, ubRect!, "UserBar 离开按钮");

    // 打开设置弹窗，等动画落定
    await settingsBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // ① 页面无横向滚动
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(docOverflow, "页面出现横向滚动").toBeLessThanOrEqual(0);

    // ② 两个设备触发器在对话框内且不越视口
    const triggers = dialog.getByRole("combobox");
    await expect(triggers).toHaveCount(2);
    const dialogRect = (await dialog.boundingBox())!;
    const viewportRect: Rect = { x: 0, y: 0, width, height: 800 };
    for (let i = 0; i < 2; i++) {
      const r = (await triggers.nth(i).boundingBox())!;
      expectInside(r, dialogRect, `触发器 ${i} 越出对话框`);
      expectInside(r, viewportRect, `触发器 ${i} 越出视口`);
    }

    // ③ 点开输入设备下拉：弹层不越视口
    await triggers.first().click();
    const content = page.locator("[data-slot=select-content]");
    await expect(content).toBeVisible();
    await page.waitForTimeout(300);
    const contentRect = (await content.boundingBox())!;
    expectInside(contentRect, viewportRect, "下拉弹层越出视口");

    // 选中超长名称设备
    await page
      .getByRole("option", { name: /SuperUltraLongBrand/ })
      .first()
      .click();
    await expect(content).toBeHidden();

    // 选中长名称后触发器仍须在对话框与视口内（grid 子项被内容撑破的旧缺陷）
    const triggerRect = (await triggers.first().boundingBox())!;
    expectInside(triggerRect, dialogRect, "选中长名称后触发器越出对话框");
    expectInside(triggerRect, viewportRect, "选中长名称后触发器越出视口");

    // ④ 触发器内文本截断：内容被裁剪（scrollWidth > clientWidth）且以省略号呈现
    const value = triggers.first().locator("[data-slot=select-value]");
    const trunc = await value.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        textOverflow: cs.textOverflow,
        right: r.right,
      };
    });
    expect(trunc.textOverflow).toBe("ellipsis");
    expect(trunc.scroll, "长设备名未被截断").toBeGreaterThan(trunc.client);
    expect(trunc.right, "触发器文本越出触发器").toBeLessThanOrEqual(
      triggerRect.x + triggerRect.width + 1,
    );
  });
}

test("连接页卡片在 320px 视口不出框", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "连 接" })).toBeVisible();
  const card = page.locator("[data-slot=card]");
  const r = (await card.boundingBox())!;
  expect(r.x, "卡片左缘越界").toBeGreaterThanOrEqual(0);
  expect(r.x + r.width, "卡片右缘越出视口").toBeLessThanOrEqual(320);
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(docOverflow, "页面出现横向滚动").toBeLessThanOrEqual(0);
});

test("邀请失效页卡片在 320px 视口不出框", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  // 拦截邀请校验接口，返回失效
  await page.route("**/api/invites/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ valid: false, reason: "测试：邀请已失效" }),
    }),
  );
  await page.goto("/invite/fake-token");
  await expect(page.getByText("邀请链接已失效")).toBeVisible();
  const card = page.locator("[data-slot=card]");
  const r = (await card.boundingBox())!;
  expect(r.x, "卡片左缘越界").toBeGreaterThanOrEqual(0);
  expect(r.x + r.width, "卡片右缘越出视口").toBeLessThanOrEqual(320);
});
