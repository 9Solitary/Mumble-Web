import { expect, test, type Page } from "@playwright/test";
import { enterApp, installMockMedia, mockProxy } from "./helpers";

function documentOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function expectNoHorizontalScroll(page: Page) {
  expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
}

async function expectEnglishDocument(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(description).toContain("Mumble voice space");
  await expect(page).toHaveTitle(/Mumble Web/);
}

test.describe("语言检测", () => {
  test("中文浏览器默认中文，英文浏览器默认英文", async ({ page, browser }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(
      page.getByRole("heading", { name: "加入语音" }),
    ).toBeVisible();

    const english = await browser.newContext({ locale: "en-US" });
    const englishPage = await english.newPage();
    await englishPage.goto("/");
    await expect(englishPage.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(
      englishPage.getByRole("heading", { name: "Join voice" }),
    ).toBeVisible();
    await english.close();
  });

  test("?lang= 覆盖 localStorage，localStorage 覆盖浏览器语言", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mumble-web.locale", "en-US");
    });

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");

    await page.goto("/?lang=zh");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(
      page.getByRole("heading", { name: "加入语音" }),
    ).toBeVisible();

    // URL 只是一次性覆盖，不会改写已保存的选择。
    expect(
      await page.evaluate(() => localStorage.getItem("mumble-web.locale")),
    ).toBe("en-US");
  });

  test("?lang=en 别名可用", async ({ page }) => {
    await page.goto("/?lang=en");
    await expectEnglishDocument(page);
    await expect(
      page.getByRole("heading", { name: "Join voice" }),
    ).toBeVisible();
  });
});

test.describe("语言切换与元信息", () => {
  test("设置 > 外观切英文：即时生效、持久化、刷新保持", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await enterApp(page, "Language switch", "/?lang=zh-CN");

    await page.getByTestId("voice-panel").getByTestId("voice-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("settings-tab-appearance").click();
    await expect(dialog).toContainText("语言与地区");

    await dialog.getByTestId("settings-language").click();
    await page.getByRole("option", { name: "English" }).click();

    await expect(dialog.getByRole("tab", { name: "Appearance" })).toBeVisible();
    await expect(dialog).toContainText("Language & region");
    await expectEnglishDocument(page);
    expect(
      await page.evaluate(() => localStorage.getItem("mumble-web.locale")),
    ).toBe("en-US");
    expect(new URL(page.url()).searchParams.has("lang")).toBe(false);

    await dialog.getByTestId("settings-done").click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId("voice-panel").getByTestId("voice-settings"),
    ).toHaveAttribute("aria-label", "Settings");

    await page.reload();
    await expectEnglishDocument(page);
    await expect(
      page.getByRole("heading", { name: "Join voice" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("mumble-web.locale")),
    ).toBe("en-US");
  });
});

test.describe("英文界面回归", () => {
  test("主界面、聊天、语音卡、设置、账户菜单", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterApp(page, "English user", "/?lang=en");

    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(
      page.getByTestId("chat-area").getByText("Welcome to 根频道"),
    ).toBeVisible();
    await expect(page.getByTestId("composer-input")).toHaveAttribute(
      "placeholder",
      "Message 根频道",
    );

    // 进入一个语音频道，让离开按钮可用
    await page.getByTestId("channel-1").dblclick();
    await expect(page.getByTestId("chat-header")).toContainText("闲聊");

    const panel = page.getByTestId("voice-panel");
    await expect(panel.getByTestId("voice-mute")).toHaveAttribute(
      "aria-label",
      "Mute",
    );
    await expect(panel.getByTestId("voice-deafen")).toHaveAttribute(
      "aria-label",
      "Deafen",
    );
    await expect(panel.getByTestId("voice-leave")).toHaveAttribute(
      "aria-label",
      "Leave voice",
    );
    await expect(panel.getByTestId("voice-settings")).toHaveAttribute(
      "aria-label",
      "Settings",
    );
    await expect(panel.getByTestId("voice-mode")).toHaveAttribute(
      "aria-label",
      /Voice mode/,
    );

    await panel.getByTestId("voice-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();
    for (const name of [
      "Audio",
      "Voice",
      "Shortcuts",
      "Appearance",
      "Diagnostics",
      "About",
    ]) {
      await expect(dialog.getByRole("tab", { name })).toBeVisible();
    }
    await dialog.getByTestId("settings-tab-appearance").click();
    await expect(dialog).toContainText("Language & region");
    await dialog.getByTestId("settings-tab-diagnostics").click();
    await expect(dialog).toContainText("Connection diagnostics");
    await expect(dialog.getByTestId("settings-reset")).toHaveText(
      "Reset to defaults",
    );
    await dialog.getByTestId("settings-done").click();
    await expect(dialog).toBeHidden();

    await page.getByTestId("account-menu-trigger").click();
    await expect(page.getByTestId("account-logout")).toContainText("Sign out");
    await page.keyboard.press("Escape");

    const composer = page.getByTestId("composer-input");
    await composer.fill("hello from english");
    await composer.press("Enter");
    await expect(page.getByTestId("messages")).toContainText("hello from english");
  });

  test("连接失败：英文摘要 + 原始详情；未知 code 保留详情", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.routeWebSocket("**/ws", (ws) => {
      ws.send(
        JSON.stringify({
          type: "hello",
          sid: "e2e-i18n-error",
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
            code: "server_password",
            reason: "Incorrect server password",
          }),
        );
      });
    });

    await page.goto("/?lang=en");
    await page.getByTestId("connect-username").fill("Error test");
    await page.getByTestId("connect-submit").click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Incorrect server password.");
    await alert.getByText("Details").click();
    await expect(alert).toContainText("Incorrect server password");

    await page.unrouteAll();
    await page.routeWebSocket("**/ws", (ws) => {
      ws.send(
        JSON.stringify({
          type: "hello",
          sid: "e2e-i18n-unknown",
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
            code: "mystery_code",
            reason: "upstream said no",
          }),
        );
      });
    });
    await page.goto("/?lang=en");
    await page.getByTestId("connect-username").fill("Unknown test");
    await page.getByTestId("connect-submit").click();

    const unknown = page.getByRole("alert");
    await expect(unknown).toContainText("Could not connect. Try again.");
    await unknown.getByText("Details").click();
    await expect(unknown).toContainText("upstream said no");
  });
});

test.describe("英文 320px / 邀请页", () => {
  test("连接页、主界面、设置无横向滚动", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await installMockMedia(page);
    await mockProxy(page);
    await page.goto("/?lang=en");
    await expect(page.getByTestId("connect-card")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expect(page.getByTestId("connect-submit")).toHaveText("Connect");

    await page.getByTestId("connect-username").fill("Small screen");
    await page.getByTestId("connect-submit").click();
    await expect(page.getByTestId("messages")).toBeVisible();
    await expectNoHorizontalScroll(page);

    await expect(page.getByTestId("voice-dock")).toBeVisible();
    const composer = await page.getByTestId("composer-input").boundingBox();
    expect(composer?.width).toBeGreaterThan(150);

    await page.getByTestId("voice-dock").getByTestId("voice-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await dialog.getByTestId("settings-tab-appearance").click();
    await expect(dialog).toContainText("Language & region");
    await dialog.getByTestId("settings-tab-diagnostics").click();
    await expect(dialog).toContainText("Connection diagnostics");
    await expect(dialog.getByTestId("settings-done")).toBeVisible();
    await dialog.getByTestId("settings-done").click();
    await expect(dialog).toBeHidden();
  });

  test("会话终止页与邀请失效页无横向滚动", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.routeWebSocket("**/ws", (ws) => {
      ws.send(
        JSON.stringify({
          type: "hello",
          sid: "e2e-i18n-ended",
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
    await page.goto("/?lang=en");
    await page.getByTestId("connect-username").fill("Ended test");
    await page.getByTestId("connect-submit").click();
    await expect(
      page.getByRole("heading", { name: "This name signed in elsewhere" }),
    ).toBeVisible();
    await expect(page.getByTestId("session-retry")).toBeVisible();
    await expect(page.getByTestId("session-change-name")).toContainText(
      "Use another name",
    );
    await expect(page.getByTestId("session-ended")).toContainText(
      "This page will not reconnect automatically.",
    );
    await expectNoHorizontalScroll(page);

    await page.route("**/api/invites/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          valid: false,
          code: "invite_invalid",
          reason: "邀请链接无效、已过期或已被使用",
        }),
      }),
    );
    await page.goto("/invite/fake-token?lang=en");
    await expect(
      page.getByRole("heading", { name: "This invite link has expired" }),
    ).toBeVisible();
    await expect(page.getByTestId("invite-invalid-card")).toContainText(
      "single-use",
    );
    await expectNoHorizontalScroll(page);
  });

  test("有效邀请只显示用户名", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/invites/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ valid: true }),
      }),
    );
    await page.goto("/invite/test-token?lang=en");
    await expect(
      page.getByRole("heading", { name: "Join by invite" }),
    ).toBeVisible();
    await expect(page.getByTestId("connect-username")).toBeVisible();
    await expect(page.getByTestId("connect-password")).toHaveCount(0);
    await expect(page.getByLabel("Address")).toHaveCount(0);
    await expect(page.getByLabel("Port")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("英文 320px：语音坞、成员与频道抽屉不溢出", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await enterApp(page, "English mobile", "/?lang=en");
    await expect(page.getByTestId("voice-dock-status")).toBeHidden();

    await page.getByTestId("chat-open-members").click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(600);
    await expect(sheet.getByPlaceholder("Search members")).toBeVisible();
    await expect(
      sheet.getByText("Online", { exact: true }).first(),
    ).toBeVisible();
    const memberBox = await sheet.boundingBox();
    expect(memberBox?.x ?? 0).toBeGreaterThanOrEqual(0);
    expect((memberBox?.x ?? 0) + (memberBox?.width ?? 0)).toBeLessThanOrEqual(320);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Channels" }).click();
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Channels");
    await page.waitForTimeout(600);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("英文 320px：设置六个 Tab、快捷键设置与帮助不溢出", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await enterApp(page, "English settings", "/?lang=en");

    await page.getByTestId("voice-dock").getByTestId("voice-settings").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    for (const [name, panel] of [
      ["Audio", "settings-panel-audio"],
      ["Voice", "settings-panel-voice"],
      ["Shortcuts", "settings-panel-shortcuts"],
      ["Appearance", "settings-panel-appearance"],
      ["Diagnostics", "settings-panel-diagnostics"],
      ["About", "settings-panel-about"],
    ] as const) {
      await dialog.getByRole("tab", { name }).click();
      await expect(dialog.getByTestId(panel)).toBeVisible();
      await expectNoHorizontalScroll(page);
    }

    await dialog.getByRole("tab", { name: "Shortcuts" }).click();
    await expect(dialog.getByText("Keyboard shortcuts", { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("shortcut-value-toggleMute")).toHaveText(
      "Ctrl+Shift+M",
    );
    await dialog.getByTestId("shortcut-change-toggleMute").click();
    await expect(dialog).toContainText("Recording: Mute microphone / unmute");
    await page.keyboard.press("Escape");
    await expect(dialog.getByTestId("shortcut-recording")).toBeHidden();

    await dialog.getByTestId("settings-done").click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Control+Shift+Slash");
    const help = page.getByTestId("shortcuts-dialog");
    await expect(help).toBeVisible();
    await expect(help).toContainText("Push to talk");
    await expect(help).toContainText("Ctrl+Shift+M");
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });
});
