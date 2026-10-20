import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

async function openDiagnostics(page: import("@playwright/test").Page) {
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("settings-tab-diagnostics").click();
  await expect(dialog.getByTestId("settings-panel-diagnostics")).toBeVisible();
  return dialog;
}

test("诊断：事件日志长列表内部滚动，复制与导出可用", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1024, height: 576 });
  await enterApp(page);

  // 制造足够多的诊断事件，让日志超出限高。
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) window.dispatchEvent(new Event("online"));
  });

  const dialog = await openDiagnostics(page);
  const log = dialog.getByTestId("diagnostics-log");
  await expect(log).toContainText("online");
  await expect
    .poll(() => log.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  const copy = dialog.getByTestId("diagnostics-copy");
  await copy.click();
  await expect(copy).toContainText("已复制");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "已复制" }),
  ).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(clipboard) as { events: unknown[] };
  expect(parsed.events.length).toBeGreaterThan(30);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByTestId("diagnostics-export").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mumble-diagnostics-.*\.json$/);
  await expect(dialog.getByTestId("diagnostics-export")).toContainText("已导出");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "已导出" }),
  ).toBeVisible();
});

test("诊断：1024×576 下弹窗与日志不越界，底栏可达", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await enterApp(page);
  const dialog = await openDiagnostics(page);
  await page.waitForTimeout(300);

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(576);

  const logBox = await dialog.getByTestId("diagnostics-log").boundingBox();
  expect(logBox).not.toBeNull();
  expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(576);

  await expect(dialog.getByRole("button", { name: "完成" })).toBeVisible();
  await expect(dialog.getByTestId("settings-reset")).toBeVisible();
  await expect(dialog.getByTestId("diagnostics-copy")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
