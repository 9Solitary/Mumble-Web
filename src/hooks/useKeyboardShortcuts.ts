import { useEffect, useRef } from "react";

import { useAppStore } from "@/store/appStore";
import { useShortcutStore } from "@/store/shortcutStore";
import {
  detectMac,
  isPushToTalkBlockedTarget,
  isTypingTarget,
  matchesShortcut,
  normalizeKey,
} from "@/lib/shortcuts";

function hasOpenDialog(): boolean {
  return !!document.querySelector('[role="dialog"]');
}

export function useKeyboardShortcuts({
  onHelp,
  onSearchMembers,
}: {
  onHelp: () => void;
  onSearchMembers: () => void;
}) {
  const bindings = useShortcutStore((s) => s.bindings);
  const pttMode = useAppStore((s) => s.pttMode);
  const pttHeldRef = useRef(false);

  useEffect(() => {
    const mac = detectMac();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const typing = isTypingTarget(event.target);
      const matches = (binding: (typeof bindings)[keyof typeof bindings]) =>
        matchesShortcut(binding, event, mac) && (binding.mod || !typing);

      // 按键说话是“按住”而非切换，键位可改，默认 Space。
      if (
        pttMode === "ptt" &&
        !event.repeat &&
        matchesShortcut(bindings.pushToTalk, event, mac) &&
        !isPushToTalkBlockedTarget(event.target) &&
        !hasOpenDialog()
      ) {
        event.preventDefault();
        pttHeldRef.current = true;
        useAppStore.getState().setTransmitting(true);
        return;
      }

      // 弹窗打开时暂停全局动作，避免在设置/查看器里误触。
      if (hasOpenDialog()) return;
      if (event.repeat) return;

      if (matches(bindings.showHelp)) {
        event.preventDefault();
        onHelp();
        return;
      }
      if (matches(bindings.searchMembers)) {
        event.preventDefault();
        onSearchMembers();
        return;
      }
      if (matches(bindings.toggleMute)) {
        event.preventDefault();
        const state = useAppStore.getState();
        if (state.self) state.setSelfMute(!state.selfMuted);
        return;
      }
      if (matches(bindings.toggleDeafen)) {
        event.preventDefault();
        const state = useAppStore.getState();
        if (state.self) state.setSelfDeaf(!state.selfDeafened);
      }
    };

    const release = () => {
      if (!pttHeldRef.current) return;
      pttHeldRef.current = false;
      useAppStore.getState().setTransmitting(false);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // 只比较键，不要求修饰键仍按住；先松 Ctrl 再松字母也能停。
      if (normalizeKey(event.key) === bindings.pushToTalk.key) release();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      release();
    };
  }, [bindings, onHelp, onSearchMembers, pttMode]);
}
