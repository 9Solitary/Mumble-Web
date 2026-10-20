import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHORTCUTS,
  bindingFromEvent,
  formatAriaShortcut,
  formatShortcut,
  matchesShortcut,
  normalizeKey,
  shortcutIssue,
} from "./shortcuts";

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("shortcut formatting", () => {
  it("按平台显示 Ctrl / Cmd，并保留修饰键顺序", () => {
    expect(formatShortcut(DEFAULT_SHORTCUTS.toggleMute, false)).toBe(
      "Ctrl+Shift+M",
    );
    expect(formatShortcut(DEFAULT_SHORTCUTS.toggleMute, true)).toBe(
      "Cmd+Shift+M",
    );
    expect(formatAriaShortcut(DEFAULT_SHORTCUTS.toggleMute, false)).toBe(
      "Control+Shift+M",
    );
    expect(formatAriaShortcut(DEFAULT_SHORTCUTS.toggleMute, true)).toBe(
      "Meta+Shift+M",
    );
    const single = { mod: false, shift: false, alt: false, key: "u" };
    expect(formatShortcut(single, false)).toBe("U");
    expect(formatAriaShortcut(single, false)).toBe("U");
  });

  it("问号归一为斜杠，字母归一为小写", () => {
    expect(normalizeKey("?")).toBe("/");
    expect(normalizeKey("M")).toBe("m");
    expect(normalizeKey(" ")).toBe("space");
  });
});

describe("shortcut matching", () => {
  it("匹配 Ctrl 与 Cmd，并要求 Shift/Alt 精确一致", () => {
    const binding = DEFAULT_SHORTCUTS.toggleMute;
    expect(
      matchesShortcut(binding, keydown({ key: "M", ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      matchesShortcut(binding, keydown({ key: "m", metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      matchesShortcut(binding, keydown({ key: "m", ctrlKey: true, shiftKey: false })),
    ).toBe(false);
    expect(matchesShortcut(binding, keydown({ key: "m", ctrlKey: true }))).toBe(
      false,
    );

    const single = { mod: false, shift: false, alt: false, key: "u" };
    expect(matchesShortcut(single, keydown({ key: "u" }))).toBe(true);
    expect(matchesShortcut(single, keydown({ key: "u", ctrlKey: true }))).toBe(
      false,
    );
  });

  it("录制允许单键，并把 ? 记为 /", () => {
    expect(bindingFromEvent(keydown({ key: "u", ctrlKey: true }))).toMatchObject({
      mod: true,
      key: "u",
      shift: false,
    });
    expect(bindingFromEvent(keydown({ key: "u" }))).toMatchObject({
      mod: false,
      key: "u",
      shift: false,
    });
    expect(
      bindingFromEvent(
        keydown({ key: "?", ctrlKey: true, shiftKey: true }),
      ),
    ).toMatchObject({ mod: true, key: "/", shift: true });
    expect(bindingFromEvent(keydown({ key: "Shift" }))).toBeNull();
  });
});

describe("shortcut validation", () => {
  it("拒绝重复组合和保留键，但允许无修饰键", () => {
    expect(
      shortcutIssue(DEFAULT_SHORTCUTS.searchMembers, "toggleMute", DEFAULT_SHORTCUTS),
    ).toBe("duplicate");
    expect(
      shortcutIssue(
        { mod: false, shift: false, alt: false, key: "u" },
        "toggleMute",
        DEFAULT_SHORTCUTS,
      ),
    ).toBeNull();
    expect(
      shortcutIssue(
        { mod: false, shift: false, alt: false, key: "space" },
        "toggleMute",
        DEFAULT_SHORTCUTS,
      ),
    ).toBe("reserved");
  });

  it("默认组合键互不重复", () => {
    const actions = Object.keys(DEFAULT_SHORTCUTS) as (keyof typeof DEFAULT_SHORTCUTS)[];
    for (const action of actions) {
      expect(shortcutIssue(DEFAULT_SHORTCUTS[action], action, DEFAULT_SHORTCUTS)).toBe(
        null,
      );
    }
  });
});
