import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("设置：1024×576 六个 Tab 都能打开，底栏始终可见", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await enterApp(page);
  const dialog = await openSettings(page);
  await page.waitForTimeout(300); // 等 Radix 打开动画结束再量尺寸

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(576);

  for (const [name, panel] of [
    ["音频", "settings-panel-audio"],
    ["语音", "settings-panel-voice"],
    ["快捷键", "settings-panel-shortcuts"],
    ["外观", "settings-panel-appearance"],
    ["诊断", "settings-panel-diagnostics"],
    ["关于", "settings-panel-about"],
  ] as const) {
    await dialog.getByRole("tab", { name }).click();
    await expect(dialog.getByTestId(panel)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "完成" })).toBeVisible();
    await expect(dialog.getByTestId("settings-reset")).toBeVisible();
  }

  await expect(dialog.getByTestId("about-web-version")).toHaveText(
    /^\d+\.\d+\.\d+/,
  );
});

test("设置：改动后显示“已保存”，刷新后值保持", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);
  const dialog = await openSettings(page);

  await expect(dialog).toContainText("更改会自动保存");
  const gain = dialog.getByRole("slider", { name: "输入音量" });
  await gain.focus();
  await gain.press("ArrowRight");
  await expect(dialog.getByText("已保存")).toBeVisible();

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("mumble-web.settings");
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored?.micGain).toBeGreaterThan(1);
});

test("悬停显示“设置”，关闭设置后不残留工具提示", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);
  const trigger = page.getByTestId("voice-panel").getByTestId("voice-settings");
  await trigger.hover();
  await expect(page.getByRole("tooltip")).toContainText("设置");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await dialog.getByTestId("settings-done").click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("设置：恢复默认包含音量，语言保持不变", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mumble-web.settings",
      JSON.stringify({
        version: 2,
        micGain: 1.8,
        outputVolume: 0.4,
        lowLatencyBuffer: false,
      }),
    );
    localStorage.setItem("mumble-web.locale", "en-US");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page, "Reset user", "/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");

  const dialog = await openSettings(page);
  await expect(dialog.getByTestId("settings-output-volume")).toContainText("40%");
  await expect(dialog).toContainText("180%");

  await dialog.getByTestId("settings-reset").click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Restore default settings?");
  await expect(confirm).toContainText("language and theme stay as they are");
  await page.getByTestId("settings-reset-confirm").click();
  await expect(confirm).toBeHidden();

  await expect(dialog.getByTestId("settings-output-volume")).toContainText("100%");
  await expect(dialog).toContainText("100%");
  await expect(dialog).toContainText("Defaults restored");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("mumble-web.settings");
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored?.micGain).toBe(1);
  expect(stored?.outputVolume).toBe(1);
  expect(stored?.lowLatencyBuffer).toBe(true);
});
