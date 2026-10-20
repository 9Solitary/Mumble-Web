import { expect, test } from "@playwright/test";
import { enterApp } from "./helpers";

test("大图压缩：在消息预算内保留更高分辨率", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterApp(page);

  const fileHandle = await page.evaluateHandle(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    let seed = 123456789;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        image.data[index] = Math.min(
          255,
          30 + (x / canvas.width) * 180 + random() * 30,
        );
        image.data[index + 1] = Math.min(
          255,
          40 + (y / canvas.height) * 120 + random() * 30,
        );
        image.data[index + 2] = Math.min(
          255,
          50 + (1 - x / canvas.width) * 140 + random() * 30,
        );
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.9,
      );
    });
    return new File([blob], "large.jpg", { type: "image/jpeg" });
  });

  await page.locator('input[type="file"]').evaluate((input, file) => {
    const transfer = new DataTransfer();
    transfer.items.add(file as File);
    Object.defineProperty(input, "files", {
      value: transfer.files,
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, fileHandle);

  const thumb = page.locator('[data-testid="message-image"] img').last();
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  const info = await thumb.evaluate((element) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
    length: element.src.length,
  }));

  // 旧算法会压到 840×560；新算法应在同一预算内保留更大的分辨率。
  expect(info.width).toBeGreaterThanOrEqual(1100);
  expect(info.height).toBeGreaterThanOrEqual(700);
  expect(info.length).toBeLessThanOrEqual(131_000);

  await page.locator('[data-testid="message-image"]').last().click();
  const dialog = page.getByRole("dialog", { name: "图片查看器" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  const lightbox = dialog.getByRole("img", { name: "图片查看器" });
  const box = await lightbox.boundingBox();
  // 1280 视口下应缩小显示，而不是把 1200px 的源图再放大。
  expect(box?.width ?? 0).toBeLessThanOrEqual(info.width);
});
