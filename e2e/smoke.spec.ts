import { expect, test } from "@playwright/test";

// smoke：首页能打开并出现连接界面（无需真实后端，代理不可用时页面仍应渲染）
test("首页显示连接界面", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Mumble Web/);
  await expect(page.getByText("Mumble Web")).toBeVisible();
  await expect(page.getByLabel(/用户名/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "连 接" }),
  ).toBeVisible();
});
