import { expect, test, type Locator, type Page } from "@playwright/test";

async function card(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("connect-card")).toBeVisible();
}

async function lineCount(locator: Locator) {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).filter((r) => r.width > 1).length;
  });
}

test("desktop connect layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await card(page);
  const h1 = page.locator("section h1").first();
  const body = page.locator("section h1 + p");
  expect(await lineCount(h1)).toBe(1);
  expect(await lineCount(body)).toBe(1);
  const overflow = await h1.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBeFalsy();
  await expect(page.getByText("浏览器里的语音空间")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "加入语音" })).toBeVisible();
});

test("1024 connect layout", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await card(page);
  const h1 = page.locator("section h1").first();
  const body = page.locator("section h1 + p");
  expect(await lineCount(h1)).toBe(1);
  expect(await lineCount(body)).toBe(1);
  await expect(page.getByText("浏览器里的语音空间")).toHaveCount(0);
});

test("mobile connect layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await card(page);
  await expect(page.getByText("浏览器里的语音空间")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "加入语音" })).toBeVisible();
});

test("english connect layout", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 576 });
  await page.goto("/?lang=en");
  await expect(page.getByTestId("connect-card")).toBeVisible();
  const h1 = page.locator("section h1").first();
  const body = page.locator("section h1 + p");
  await expect(h1).toHaveText("Back to your voice space");
  expect(await lineCount(h1)).toBe(1);
  expect(await lineCount(body)).toBe(1);
  await expect(page.getByText("Your voice space in the browser")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Join voice" })).toBeVisible();
});
