import { expect, test, type Page } from "@playwright/test";

// 设置页在短屏/高缩放下的可达性：
// - 弹窗必须落在视口内，底部“完成”始终可见；
// - 诊断是独立 Tab，不把其他内容顶走；
// - 退出登录不再依赖滚动到底部（账户菜单可达）。

async function mockBackend(page: Page) {
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-settings",
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
          self: { session: 1, name: env.username ?? "设置用户", channelId: 0 },
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
    });
  });
}

async function enter(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名/).fill("设置测试用户");
  await page.getByTestId("connect-submit").click();
  const settings = page.locator("button:has(svg.lucide-settings):visible").first();
  await expect(settings).toBeVisible();
  return settings;
}

test.describe("设置页短屏与诊断", () => {
  test("旧设置输出音量 0 迁移为 100%", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mumble-web.settings", JSON.stringify({ outputVolume: 0 }));
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
    const settings = await enter(page);
    await settings.click();
    await page.waitForTimeout(300);

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/输出音量\s*100%/);
    await expect(dialog).not.toContainText("0% 会听不到任何声音");
  });

  test("1024×576：弹窗不越界，诊断可用，完成按钮可见", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 576 });
    await mockBackend(page);
    const settings = await enter(page);
    await settings.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300); // 等 Radix 打开动画结束再量尺寸
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(576);

    await page.getByRole("tab", { name: "诊断" }).click();
    await expect(page.getByRole("button", { name: "复制诊断信息" })).toBeVisible();
    await expect(page.getByRole("button", { name: "完成" })).toBeVisible();
    await expect(page.getByRole("button", { name: "恢复默认" })).toBeVisible();

    // 不需要滚到底部也能关闭设置
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("语音设置：自动模式下阈值滑条可拖动并切换为手动", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
    const settings = await enter(page);
    await settings.click();
    await page.waitForTimeout(300); // 等弹窗打开动画结束，避免按动画中的坐标拖动
    await page.getByRole("tab", { name: "语音" }).click();
    await page.waitForTimeout(150);

    const slider = page.getByRole("dialog").locator('[data-slot="slider"]').first();
    await expect(slider).toBeVisible();
    expect(await slider.getAttribute("aria-disabled")).toBe("false");
    const box = (await slider.boundingBox())!;
    expect(box.width, "阈值滑条宽度异常").toBeGreaterThan(180);

    // 鼠标从左侧拖到中间：应切换为手动并出现“恢复自动”
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "恢复自动" })).toBeVisible();

    // 再拖到最左端：-60 dB 是最灵敏的手动值，不等于自动
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 1, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "恢复自动" })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("-60 dB");

    // 只有“恢复自动”/触发方式里的自动才回到自动
    await page.getByRole("button", { name: "恢复自动" }).click();
    await expect(page.getByRole("button", { name: "恢复自动" })).toBeHidden();
  });

  test("音频页滑条有可用宽度且可鼠标拖动", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
    const settings = await enter(page);
    await settings.click();
    await page.waitForTimeout(300); // 等弹窗打开动画结束

    const slider = page.getByRole("dialog").locator('[data-slot="slider"]').first();
    const box = (await slider.boundingBox())!;
    expect(box.width, "麦克风增益滑条宽度为 0").toBeGreaterThan(200);

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toContainText("160%");
  });

  test("无麦克风权限：设置不崩溃，显示授权提示", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
    const settings = await enter(page);
    await settings.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("需要麦克风权限才能列出设备")).toBeVisible();
    // 页面没有进入 ErrorBoundary
    await expect(page.getByText("页面出现错误")).toHaveCount(0);
  });

  test("账户菜单可直接退出登录（不依赖设置滚动）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockBackend(page);
    await enter(page);
    await page.getByRole("button", { name: "账户" }).click();
    await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeVisible();
  });
});
