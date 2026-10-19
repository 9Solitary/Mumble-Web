import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

test("输入框 1→6 行自动增高，超出后内部滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const input = page.getByTestId("composer-input");
  const single = await input.boundingBox();
  expect(single?.height).toBeLessThanOrEqual(42);

  await input.fill("第一行\n第二行\n第三行\n第四行\n第五行\n第六行");
  const sixLines = await input.boundingBox();
  expect(sixLines?.height).toBeGreaterThan(single?.height ?? 0);
  expect(sixLines?.height).toBeLessThanOrEqual(141);

  await input.fill(Array.from({ length: 15 }, (_, i) => `长文本 ${i + 1}`).join("\n"));
  await expect
    .poll(async () => input.evaluate((el) => getComputedStyle(el).overflowY))
    .toBe("auto");
  const capped = await input.boundingBox();
  expect(capped?.height).toBeLessThanOrEqual(141);

  // 消息区不被输入框无限挤压
  const messages = await page.getByTestId("messages").boundingBox();
  expect(messages?.height).toBeGreaterThan(200);
});

test("Shift+Enter 换行，Enter 发送", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const input = page.getByTestId("composer-input");
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.pressSequentially("第二行");
  await expect(input).toHaveValue("第一行\n第二行");

  await input.press("Enter");
  await expect(input).toHaveValue("");
});

test("接近长度上限时显示字符计数", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const input = page.getByTestId("composer-input");
  await input.fill("字".repeat(4100));
  await expect(page.getByText("4100 / 5000")).toBeVisible();
});

test("320px：长草稿不产生横向滚动，输入框仍可用", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await enterApp(page);

  const input = page.getByTestId("composer-input");
  await input.fill(Array.from({ length: 10 }, (_, i) => `长文本 ${i + 1}`).join("\n"));

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  const box = await input.boundingBox();
  expect(box?.width).toBeGreaterThan(150);
  expect(box?.height).toBeLessThanOrEqual(141);
  await expect
    .poll(async () => input.evaluate((el) => getComputedStyle(el).overflowY))
    .toBe("auto");
});
