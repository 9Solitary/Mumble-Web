import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

function noHorizontalScroll(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("桌面外壳：顶栏 56、左侧语音卡、三栏，只有一个设置/账户入口", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  const topbar = await page.getByTestId("topbar").boundingBox();
  const panel = await page.getByTestId("voice-panel").boundingBox();
  const sidebar = await page.getByTestId("channel-sidebar").boundingBox();
  const members = await page.getByTestId("member-list").boundingBox();

  expect(topbar?.height).toBe(56);
  expect(panel?.width).toBe(268);
  expect(panel?.x).toBe(0);
  expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBe(900);
  await expect(page.getByTestId("voice-dock")).toBeHidden();
  expect(sidebar?.width).toBe(268);
  expect(members?.width).toBe(252);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("chat-area")).toBeVisible();

  // 语音控件在左侧栏内，不再有全宽底部坞
  const mode = await page.getByRole("button", { name: /发言方式/ }).boundingBox();
  const settingsBox = await page.locator("button:has(svg.lucide-settings):visible").boundingBox();
  expect(mode?.x).toBeLessThan(268);
  expect(settingsBox?.x).toBeLessThan(268);

  // 决策 B：常驻齿轮只在左侧语音卡；账户菜单里没有第二个设置入口。
  await expect(page.locator("button:has(svg.lucide-settings):visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "账户" })).toHaveCount(1);

  await page.getByRole("button", { name: "账户" }).click();
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "设置" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeHidden();
});

test("左侧语音卡：点发言方式进入语音设置，离开为红色图标", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  // 进入一个语音频道，让离开按钮可用
  await page.getByTestId("channel-sidebar").getByRole("button", { name: /闲聊/ }).dblclick();
  await expect(page.getByTestId("chat-header")).toContainText("闲聊");
  const leave = page.getByRole("button", { name: "离开语音" });
  await expect(leave).toBeVisible();
  await expect(leave).toHaveCSS("color", "rgb(255, 107, 107)");

  // 没有“切换”文字按钮；点当前模式文字直接进设置 > 语音
  await expect(page.getByText("切换为自由发言")).toHaveCount(0);
  await expect(page.getByText("切换为按键说话")).toHaveCount(0);
  await page.getByRole("button", { name: /发言方式/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "语音" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.getByRole("button", { name: "完成" }).click();
  await expect(dialog).toBeHidden();
});

test("390px：聊天、静音、频道抽屉加入、离开、设置可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterApp(page);

  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("channel-sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "频道" })).toBeVisible();

  const composer = await page.getByTestId("composer-input").boundingBox();
  expect(composer?.width).toBeGreaterThan(180);

  // 静音 / 取消静音
  await page.getByRole("button", { name: "静音" }).click();
  await expect(page.getByRole("button", { name: "取消静音" })).toBeVisible();
  await page.getByRole("button", { name: "取消静音" }).click();
  await expect(page.getByRole("button", { name: "静音" })).toBeVisible();

  // 抽屉：选择频道 → 加入 → 关闭
  await page.getByRole("button", { name: "频道" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox?.x).toBeGreaterThanOrEqual(0);
  expect((sheetBox?.x ?? 0) + (sheetBox?.width ?? 0)).toBeLessThanOrEqual(390);

  await sheet.getByRole("button", { name: /闲聊/ }).first().click();
  await sheet.getByRole("button", { name: "加入频道" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("chat-header")).toContainText("闲聊");

  // 离开语音为红色描边，离开后回到大厅
  const leaveButton = page.getByRole("button", { name: "离开语音" });
  await expect(leaveButton).toHaveCSS("color", "rgb(255, 107, 107)");
  await leaveButton.click();
  await expect(page.getByRole("button", { name: "已在大厅" })).toBeVisible();

  // 设置仍可打开
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("320px：无横向滚动，语音坞四个操作都是 44px 且在视口内", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await enterApp(page);

  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  const composer = await page.getByTestId("composer-input").boundingBox();
  expect(composer?.width).toBeGreaterThan(150);

  const buttons = await page
    .getByTestId("voice-dock")
    .locator("button:visible")
    .evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
          x: rect.x,
          width: rect.width,
          height: rect.height,
        };
      }),
    );

  expect(buttons.length).toBeGreaterThanOrEqual(4);
  for (const button of buttons) {
    expect(button.label, "语音坞出现无名按钮").not.toBe("");
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(320);
  }

  await page.getByRole("button", { name: "频道" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox?.x).toBeGreaterThanOrEqual(0);
  expect((sheetBox?.x ?? 0) + (sheetBox?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("可见按钮都有可访问名称", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const unnamed = await page.locator("button:visible").evaluateAll((els) =>
    els
      .map((el) => ({
        label:
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.textContent?.trim() ||
          "",
        html: el.outerHTML.slice(0, 160),
      }))
      .filter((item) => item.label === ""),
  );

  expect(unnamed, JSON.stringify(unnamed, null, 2)).toHaveLength(0);
});

for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [1093, 614],
] as const) {
  test(`${width}×${height}：主界面无横向滚动，顶栏/语音坞/输入框可见`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await enterApp(page);

    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    expect((await page.getByTestId("topbar").boundingBox())?.height).toBe(56);
    await expect(page.getByTestId("voice-panel")).toBeVisible();
    await expect(page.getByTestId("voice-dock")).toBeHidden();
    await expect(page.getByTestId("composer-input")).toBeVisible();
    await expect(page.getByTestId("messages")).toBeVisible();
  });
}
