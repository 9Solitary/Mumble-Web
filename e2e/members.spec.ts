import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

function noHorizontalScroll(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test("成员：树序分组、搜索、状态、音量与右键菜单", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  const list = page.getByTestId("member-list");
  await expect(list).toBeVisible();

  // 分组按频道树顺序：根频道 -> 闲聊 -> 开黑房
  const rootGroup = await list.getByTestId("member-group-0").boundingBox();
  const chatGroup = await list.getByTestId("member-group-1").boundingBox();
  const gameGroup = await list.getByTestId("member-group-2").boundingBox();
  expect(rootGroup?.y ?? 0).toBeLessThan(chatGroup?.y ?? 0);
  expect(chatGroup?.y ?? 0).toBeLessThan(gameGroup?.y ?? 0);

  // 自己固定靠前，状态用文字表达，不只靠颜色
  await expect(list.getByTestId("member-row-1")).toContainText("（我）");
  await expect(list.getByTestId("member-row-2")).toContainText("在线");
  await expect(list.getByTestId("member-row-3")).toContainText("已静音");

  // 搜索：按名字过滤并显示空态
  const search = list.getByTestId("member-search");
  await search.fill("机器人");
  await expect(list.getByTestId("member-row-2")).toBeVisible();
  await expect(list.getByTestId("member-row-3")).toBeHidden();
  await expect(list.getByTestId("member-row-4")).toBeHidden();

  await search.fill("不存在");
  await expect(list.getByText("没有匹配的成员")).toBeVisible();
  await list.getByTestId("member-no-results-clear").click();
  await expect(list.getByTestId("member-row-2")).toBeVisible();

  // 音量：远端成员点击音量按钮弹出滑条
  await list.getByTestId("member-volume-2").click();
  const slider = page.getByRole("slider", { name: "音量 · 机器人小助手" });
  await expect(slider).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(slider).toBeHidden();

  // 右键菜单：屏蔽后状态变为“已屏蔽”
  const row = list.getByTestId("member-row-2");
  await row.click({ button: "right" });
  const muteItem = page.getByRole("menuitemcheckbox", {
    name: "屏蔽此用户发言",
  });
  await expect(muteItem).toBeVisible();
  await muteItem.click();
  await expect(row).toContainText("已屏蔽");

  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test("1024px：成员栏收起，从聊天头打开成员抽屉", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterApp(page);

  await expect(page.getByTestId("member-list")).toBeHidden();
  const open = page.getByTestId("chat-open-members");
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("aria-label", "成员（4）");
  await open.click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  const drawer = page.getByTestId("member-list-drawer");
  await expect(drawer).toBeVisible();

  const search = drawer.getByTestId("drawer-member-search");
  await search.fill("开黑");
  await expect(drawer.getByTestId("drawer-member-row-4")).toBeVisible();
  await expect(drawer.getByTestId("drawer-member-row-2")).toBeHidden();
  await expect(drawer.getByTestId("drawer-member-volume-4")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test("390px：成员抽屉可用且不产生横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterApp(page);

  await page.getByTestId("chat-open-members").click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);

  const drawer = page.getByTestId("member-list-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-member-row-1")).toBeVisible();
  await expect(drawer.getByTestId("drawer-member-row-4")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

  const box = await sheet.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
