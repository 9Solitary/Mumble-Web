import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { enterApp } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

test("axe：连接页与主界面无严重问题", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("connect-card")).toBeVisible();
  await expectNoSeriousViolations(page, "连接页");

  await enterApp(page, "A11y user");
  await expectNoSeriousViolations(page, "主界面");
});

test("axe：设置六个 Tab 与帮助对话框无严重问题", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page, "A11y settings");
  await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

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
    await expectNoSeriousViolations(page, `设置 ${name}`);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Control+Shift+Slash");
  const help = page.getByTestId("shortcuts-dialog");
  await expect(help).toBeVisible();
  await page.waitForTimeout(400); // 等弹窗透明度动画结束再算对比度
  await expectNoSeriousViolations(page, "快捷键帮助");
});

test("axe：390px 主界面与设置无严重问题", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterApp(page, "A11y mobile");
  await expectNoSeriousViolations(page, "390 主界面");

  await page.getByTestId("voice-dock").getByTestId("voice-settings").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("settings-tab-appearance").click();
  await expectNoSeriousViolations(page, "390 设置");
});

test("会话终止页 axe 与键盘焦点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.routeWebSocket("**/ws", (ws) => {
    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-a11y-ended",
        version: "e2e",
        server: {
          address: "mock:64738",
          resolved: "127.0.0.1:64738",
          tlsMode: "insecure",
          voice: "tcp-tunnel",
        },
      }),
    );
    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      if (env.type !== "connect") return;
      ws.send(
        JSON.stringify({
          type: "reject",
          code: "session_takeover",
          reason: "Signed in elsewhere",
        }),
      );
    });
  });
  await page.goto("/");
  await page.getByTestId("connect-username").fill("A11y ended");
  await page.getByTestId("connect-submit").click();
  await expect(page.getByRole("heading", { name: "这个昵称在另一处登录了" })).toBeVisible();
  await expectNoSeriousViolations(page, "会话终止页");
  await expect(page.getByTestId("session-retry")).toBeVisible();
});

test("设置打开聚焦当前 Tab，方向键切换，Esc 归还触发按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page, "A11y focus");
  const trigger = page.getByTestId("voice-panel").getByTestId("voice-settings");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const audioTab = dialog.getByRole("tab", { name: "音频" });
  await expect(audioTab).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const voiceTab = dialog.getByRole("tab", { name: "语音" });
  await expect(voiceTab).toBeFocused();
  await expect(voiceTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "关于" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(audioTab).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("reduced-motion：装饰动画停止", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterApp(page, "A11y motion");
  const animation = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-eq";
    document.body.appendChild(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  expect(animation).toBe("none");
});
