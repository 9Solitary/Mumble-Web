import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

function toastWith(page: import("@playwright/test").Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

test("恢复默认：确认后出现 toast，底栏状态同步", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("settings-reset").click();
  await page.getByTestId("settings-reset-confirm").click();
  await expect(toastWith(page, "已恢复默认")).toBeVisible();
  await expect(dialog).toContainText("已恢复默认");
});

test("输出音量为 0 时点击恢复，显示 toast 并回到 100%", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mumble-web.settings",
      JSON.stringify({ version: 2, outputVolume: 0 }),
    );
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  const row = dialog.getByTestId("settings-output-volume");
  await expect(row).toContainText("0% 会听不到任何声音");

  await row.getByRole("button", { name: "恢复 100%" }).click();
  await expect(toastWith(page, "输出音量已恢复 100%")).toBeVisible();
  await expect(row).toContainText("100%");
});

test("空态使用 status 语义：聊天空态、成员无结果", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  const chatEmpty = page.getByRole("status").filter({ hasText: "欢迎来到" });
  await expect(chatEmpty).toBeVisible();

  const search = page.getByTestId("member-search");
  await search.fill("不存在的成员");
  const memberEmpty = page.getByRole("status").filter({ hasText: "没有匹配的成员" });
  await expect(memberEmpty).toBeVisible();
});
