import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

async function openShortcutSettings(page: import("@playwright/test").Page) {
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("settings-tab-shortcuts").click();
  await expect(dialog.getByTestId("settings-panel-shortcuts")).toBeVisible();
  return dialog;
}

test("默认组合键：麦克风静音、耳机静音、成员搜索、快捷键帮助", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);

  const mute = page.getByTestId("voice-panel").getByTestId("voice-mute");
  await expect(mute).toHaveAttribute("aria-keyshortcuts", "Control+Shift+M");
  expect(await mute.getAttribute("aria-pressed")).toBe("false");

  // 默认是组合键；单键不会触发默认动作。
  await page.keyboard.press("m");
  await expect(mute).toHaveAttribute("aria-label", "麦克风静音");

  await page.keyboard.press("Control+Shift+M");
  await expect(mute).toHaveAttribute("aria-label", "取消麦克风静音");
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+Shift+M");
  await expect(mute).toHaveAttribute("aria-label", "麦克风静音");

  const deafen = page.getByTestId("voice-panel").getByTestId("voice-deafen");
  await page.keyboard.press("Control+Shift+H");
  await expect(deafen).toHaveAttribute("aria-label", "取消耳机静音");
  await page.keyboard.press("Control+Shift+H");
  await expect(deafen).toHaveAttribute("aria-label", "耳机静音");

  await page.keyboard.press("Control+Shift+K");
  await expect(page.getByTestId("member-search")).toBeFocused();

  await page.keyboard.press("Control+Shift+Slash");
  const help = page.getByTestId("shortcuts-dialog");
  await expect(help).toBeVisible();
  await expect(help).toContainText("键盘快捷键");
  await expect(help).toContainText("Ctrl+Shift+M");
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});

test("设置内改键：允许单键、冲突提示、立即生效、输入框内不触发", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);
  const dialog = await openShortcutSettings(page);

  const value = dialog.getByTestId("shortcut-value-toggleMute");
  await expect(value).toHaveText("Ctrl+Shift+M");

  await dialog.getByTestId("shortcut-change-toggleMute").click();
  await expect(dialog.getByTestId("shortcut-recording")).toBeVisible();
  // 不强制 Ctrl/⌘：单键也应能保存。
  await page.keyboard.press("u");
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "快捷键已更新" }),
  ).toBeVisible();
  await expect(value).toHaveText("U");
  expect(
    await page.evaluate(() => localStorage.getItem("mumble-web.shortcuts")),
  ).toContain('"key":"u"');

  // 与其他动作冲突时不保存，并给出就地错误。
  await dialog.getByTestId("shortcut-change-toggleDeafen").click();
  await page.keyboard.press("u");
  await expect(dialog.getByRole("alert")).toContainText("已被其他动作使用");
  await expect(dialog.getByTestId("shortcut-value-toggleDeafen")).toHaveText(
    "Ctrl+Shift+H",
  );
  await page.keyboard.press("Escape");

  await dialog.getByTestId("settings-done").click();
  const mute = page.getByTestId("voice-panel").getByTestId("voice-mute");
  await expect(mute).toHaveAttribute("aria-keyshortcuts", "U");
  await page.keyboard.press("u");
  await expect(mute).toHaveAttribute("aria-label", "取消麦克风静音");
  await page.keyboard.press("u");
  await expect(mute).toHaveAttribute("aria-label", "麦克风静音");

  // 单键在输入框内不触发。
  const composer = page.getByTestId("composer-input");
  await composer.click();
  await page.keyboard.press("u");
  await expect(composer).toHaveValue("u");
  await expect(mute).toHaveAttribute("aria-label", "麦克风静音");
  await composer.fill("");

  // 打开设置后恢复单行默认值。
  const reopened = await openShortcutSettings(page);
  await reopened.getByTestId("shortcut-reset-toggleMute").click();
  await expect(reopened.getByTestId("shortcut-value-toggleMute")).toHaveText(
    "Ctrl+Shift+M",
  );
});

test("快捷键页签显示所有默认组合键和按键说话说明", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await enterApp(page);
  const dialog = await openShortcutSettings(page);

  for (const [action, combo] of [
    ["toggleMute", "Ctrl+Shift+M"],
    ["toggleDeafen", "Ctrl+Shift+H"],
    ["searchMembers", "Ctrl+Shift+K"],
    ["showHelp", "Ctrl+Shift+/"],
    ["pushToTalk", "Space"],
  ] as const) {
    await expect(dialog.getByTestId(`shortcut-value-${action}`)).toHaveText(combo);
    await expect(dialog.getByTestId(`shortcut-change-${action}`)).toBeVisible();
  }
  await expect(dialog).toContainText("按键说话（按住）");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("按键说话可改键：默认 Space，可改成单键并恢复", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page);
  const dialog = await openShortcutSettings(page);
  const value = dialog.getByTestId("shortcut-value-pushToTalk");
  await expect(value).toHaveText("Space");

  await dialog.getByTestId("shortcut-change-pushToTalk").click();
  await page.keyboard.press("v");
  await expect(value).toHaveText("V");
  expect(
    await page.evaluate(() => localStorage.getItem("mumble-web.shortcuts")),
  ).toContain('"key":"v"');

  await dialog.getByTestId("shortcut-reset-pushToTalk").click();
  await expect(value).toHaveText("Space");
});
