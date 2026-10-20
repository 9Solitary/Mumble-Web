import { create } from "zustand";

import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutBinding,
} from "@/lib/shortcuts";

export const SHORTCUT_STORAGE_KEY = "mumble-web.shortcuts";

export type ShortcutBindings = Record<ShortcutAction, ShortcutBinding>;

function cloneDefaults(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [action, { ...DEFAULT_SHORTCUTS[action] }]),
  ) as ShortcutBindings;
}

function loadBindings(): ShortcutBindings {
  const bindings = cloneDefaults();
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? "{}",
    ) as Record<string, Partial<ShortcutBinding> | undefined>;
    for (const action of SHORTCUT_ACTIONS) {
      const candidate = parsed[action];
      if (!candidate || typeof candidate !== "object") continue;
      if (
        typeof candidate.key === "string" &&
        candidate.key.length > 0 &&
        typeof candidate.mod === "boolean" &&
        typeof candidate.shift === "boolean" &&
        typeof candidate.alt === "boolean"
      ) {
        bindings[action] = {
          mod: candidate.mod,
          shift: candidate.shift,
          alt: candidate.alt,
          key: candidate.key,
        };
      }
    }
  } catch {
    /* 隐私模式或损坏数据：回退默认 */
  }
  return bindings;
}

function saveBindings(bindings: ShortcutBindings) {
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    /* 隐私模式 */
  }
}

interface ShortcutState {
  bindings: ShortcutBindings;
  setBinding: (action: ShortcutAction, binding: ShortcutBinding) => void;
  resetBinding: (action: ShortcutAction) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  bindings: loadBindings(),

  setBinding: (action, binding) => {
    const bindings = { ...get().bindings, [action]: { ...binding } };
    saveBindings(bindings);
    set({ bindings });
  },

  resetBinding: (action) => {
    const bindings = {
      ...get().bindings,
      [action]: { ...DEFAULT_SHORTCUTS[action] },
    };
    saveBindings(bindings);
    set({ bindings });
  },

  resetAll: () => {
    const bindings = cloneDefaults();
    saveBindings(bindings);
    set({ bindings });
  },
}));
