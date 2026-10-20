import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { enterApp } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function toastWith(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

function noHorizontalScroll(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(" "),
        html: node.html.slice(0, 240),
      })),
    }));
  expect(serious, `${label} 存在严重可访问性问题：${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

test("普通用户：TopBar 邀请入口 → 生成 → 复制", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3000",
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "邀请测试");

  const entry = page.getByTestId("invite-open");
  await expect(entry).toBeVisible();
  await entry.click();

  const dialog = page.getByTestId("invite-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "邀请成员" })).toBeVisible();
  await expect(dialog).toContainText("生成一条一次性链接");
  // 入口即生成：不再出现“生成邀请链接”的二次确认。
  await expect(dialog.getByTestId("invite-url")).toHaveValue(
    "http://localhost:3000/invite/e2e-invite-token",
  );
  await expect(dialog.getByTestId("invite-generate")).toHaveCount(0);
  await expect(dialog).toContainText("一次性 · 约 30 分钟内有效");
  await expect(dialog).toContainText("对方退出或断线后失效");
  await expect(dialog.getByTestId("invite-copy")).toBeFocused();

  await dialog.getByTestId("invite-copy").click();
  await expect(toastWith(page, "邀请链接已复制")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "http://localhost:3000/invite/e2e-invite-token",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(entry).toBeFocused();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test("受邀用户：看不到邀请入口", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "受邀用户", "/", { invited: true });
  await expect(page.getByTestId("messages")).toBeVisible();
  await expect(page.getByTestId("invite-open")).toHaveCount(0);
});

test("网页邀请关闭：看不到入口", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "邀请关闭", "/", { inviteEnabled: false });
  await expect(page.getByTestId("messages")).toBeVisible();
  await expect(page.getByTestId("invite-open")).toHaveCount(0);
});

test("服务端拒绝：显示失败态并可重试，不显示链接", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "邀请失败", "/", { inviteError: "invite_failed" });

  await page.getByTestId("invite-open").click();
  const dialog = page.getByTestId("invite-dialog");
  await expect(dialog.getByTestId("invite-error")).toContainText(
    "生成邀请失败，请稍后重试。",
  );
  await expect(dialog.getByTestId("invite-url")).toHaveCount(0);
  await expect(dialog.getByTestId("invite-retry")).toBeVisible();
});

test("服务端拒绝受邀用户：显示明确的禁止文案", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "受邀拒绝", "/", { inviteError: "invite_forbidden" });

  await page.getByTestId("invite-open").click();
  const dialog = page.getByTestId("invite-dialog");
  await expect(dialog.getByTestId("invite-error")).toContainText(
    "受邀加入的成员不能继续邀请其他人。",
  );
  await expect(dialog.getByTestId("invite-url")).toHaveCount(0);
});

test("390px：入口 44px，弹窗与复制按钮不出视口", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterApp(page, "邀请移动端");

  const entry = page.getByTestId("invite-open");
  await expect(entry).toBeVisible();
  const entryBox = await entry.boundingBox();
  expect(entryBox?.height).toBeGreaterThanOrEqual(44);
  expect(entryBox?.width).toBeGreaterThanOrEqual(44);

  await entry.click();
  const dialog = page.getByTestId("invite-dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(250);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(390);

  const copy = dialog.getByTestId("invite-copy");
  await expect(copy).toBeVisible();
  const copyBox = await copy.boundingBox();
  expect(copyBox?.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test("英文 320px：初始/生成态无溢出，axe 无严重问题", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await enterApp(page, "English invite", "/?lang=en", { inviteDelayMs: 700 });

  const entry = page.getByTestId("invite-open");
  await expect(entry).toBeVisible();
  const entryBox = await entry.boundingBox();
  expect(entryBox?.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

  await entry.click();
  const dialog = page.getByTestId("invite-dialog");
  await expect(dialog.getByRole("heading", { name: "Invite people" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, "邀请弹窗生成中");

  await expect(dialog.getByTestId("invite-copy")).toBeVisible();
  await expect(dialog).toContainText("Single-use · valid for about 30 min");
  await expect(dialog).toContainText("Expires when they leave or disconnect");
  const box = await dialog.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  await expectNoSeriousViolations(page, "邀请弹窗生成态");
});
