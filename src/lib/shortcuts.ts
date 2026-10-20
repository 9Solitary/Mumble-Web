export const SHORTCUT_ACTIONS = [
  "toggleMute",
  "toggleDeafen",
  "searchMembers",
  "showHelp",
  "pushToTalk",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export type ShortcutIssue = "duplicate" | "empty" | "reserved";

const RESERVED_KEYS = new Set(["escape", "tab", "enter"]);

// 默认全部要求 Ctrl/⌘，避免单键误触；按键说话仍用按住 Space。
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutBinding> = {
  toggleMute: { mod: true, shift: true, alt: false, key: "m" },
  toggleDeafen: { mod: true, shift: true, alt: false, key: "h" },
  searchMembers: { mod: true, shift: true, alt: false, key: "k" },
  showHelp: { mod: true, shift: true, alt: false, key: "/" },
  // 按键说话默认是按住 Space，作为唯一允许单键的动作。
  pushToTalk: { mod: false, shift: false, alt: false, key: "space" },
};

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

export function normalizeKey(key: string): string {
  if (!key) return "";
  if (key === " ") return "space";
  if (key === "?") return "/";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

export function formatKeyLabel(key: string): string {
  if (key === "space") return "Space";
  if (key === "escape") return "Esc";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatShortcut(
  binding: ShortcutBinding,
  mac = detectMac(),
): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "Cmd" : "Ctrl");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  parts.push(formatKeyLabel(binding.key));
  return parts.join("+");
}

// aria-keyshortcuts 使用标准键名：Meta / Control / Shift / Alt。
export function formatAriaShortcut(
  binding: ShortcutBinding,
  mac = detectMac(),
): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "Meta" : "Control");
  if (binding.shift) parts.push("Shift");
  if (binding.alt) parts.push("Alt");
  parts.push(formatKeyLabel(binding.key));
  return parts.join("+");
}

export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (event.isComposing) return null;
  const modifierKeys = ["Control", "Shift", "Alt", "Meta", "OS"];
  if (modifierKeys.includes(event.key)) return null;
  const key = normalizeKey(event.key);
  if (!key) return null;
  return {
    // 默认组合键仍带 Ctrl/⌘，但录制时允许单键，不强制修饰键。
    mod: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    key,
  };
}

export function matchesShortcut(
  binding: ShortcutBinding,
  event: KeyboardEvent,
  mac = detectMac(),
): boolean {
  void mac;
  if (event.isComposing) return false;
  // 允许 Ctrl 与 Cmd 互通，避免跨平台键盘/外接键盘无法触发。
  const primary = event.ctrlKey || event.metaKey;
  return (
    binding.mod === primary &&
    binding.shift === event.shiftKey &&
    binding.alt === event.altKey &&
    normalizeKey(event.key) === binding.key
  );
}

export function shortcutIssue(
  binding: ShortcutBinding,
  action: ShortcutAction,
  bindings: Record<ShortcutAction, ShortcutBinding>,
): ShortcutIssue | null {
  if (!binding.key) return "empty";
  if (RESERVED_KEYS.has(binding.key)) return "reserved";
  if (binding.key === "space" && action !== "pushToTalk") return "reserved";
  for (const other of SHORTCUT_ACTIONS) {
    if (other === action) continue;
    const candidate = bindings[other];
    if (
      candidate.mod === binding.mod &&
      candidate.shift === binding.shift &&
      candidate.alt === binding.alt &&
      candidate.key === binding.key
    ) {
      return "duplicate";
    }
  }
  return null;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

// 按键说话不能吞掉按钮/链接上的 Space 激活。
export function isPushToTalkBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTypingTarget(target)) return true;
  return !!target.closest(
    "button, a, [role='button'], [role='menuitem'], [role='option'], [role='tab']",
  );
}
