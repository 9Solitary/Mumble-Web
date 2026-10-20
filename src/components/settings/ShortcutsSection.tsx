import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useShortcutStore } from "@/store/shortcutStore";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  bindingFromEvent,
  detectMac,
  formatShortcut,
  shortcutIssue,
  type ShortcutAction,
  type ShortcutIssue,
} from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Section } from "@/components/settings/shared";
import { toastSuccess } from "@/lib/toast";

export function ShortcutsSection() {
  const { t } = useTranslation();
  const bindings = useShortcutStore((s) => s.bindings);
  const setBinding = useShortcutStore((s) => s.setBinding);
  const resetBinding = useShortcutStore((s) => s.resetBinding);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<ShortcutIssue | null>(null);
  const mac = detectMac();

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setRecording(null);
        setError(null);
        return;
      }

      const binding = bindingFromEvent(event);
      if (!binding) return;

      // 录制期间截获事件，避免同时触发全局快捷键。
      event.preventDefault();
      event.stopPropagation();
      const issue = shortcutIssue(binding, recording, bindings);
      if (issue) {
        setError(issue);
        return;
      }
      setBinding(recording, binding);
      setRecording(null);
      setError(null);
      toastSuccess(t("shortcuts.updated"));
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, recording, setBinding, t]);

  const startRecording = (action: ShortcutAction) => {
    setRecording(action);
    setError(null);
  };

  const cancelRecording = () => {
    setRecording(null);
    setError(null);
  };

  return (
    <Section title={t("shortcuts.title")}>
      <div className="divide-y divide-line">
        {SHORTCUT_ACTIONS.map((action) => {
          const isDefault =
            JSON.stringify(bindings[action]) ===
            JSON.stringify(DEFAULT_SHORTCUTS[action]);
          const isRecording = recording === action;
          return (
            <div
              key={action}
              data-testid={`shortcut-row-${action}`}
              className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0 text-[13px] font-medium text-fg">
                {t(`shortcuts.actions.${action}`)}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                <Kbd
                  data-testid={`shortcut-value-${action}`}
                  className="h-6 bg-ink-800 px-2 text-[11px] text-fg"
                >
                  {formatShortcut(bindings[action], mac)}
                </Kbd>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid={`shortcut-change-${action}`}
                  onClick={() =>
                    isRecording ? cancelRecording() : startRecording(action)
                  }
                >
                  {isRecording ? t("shortcuts.cancel") : t("shortcuts.change")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid={`shortcut-reset-${action}`}
                  disabled={isDefault}
                  onClick={() => {
                    resetBinding(action);
                    toastSuccess(t("shortcuts.resetDone"));
                  }}
                >
                  {t("shortcuts.reset")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {recording && (
        <div
          data-testid="shortcut-recording"
          aria-live="polite"
          className="rounded-control border border-mint/30 bg-mint/[0.06] px-3 py-2 text-[11.5px] text-mint"
        >
          <p className="font-medium">
            {t("shortcuts.recording", {
              action: t(`shortcuts.actions.${recording}`),
            })}
          </p>
          <p className="mt-0.5 text-[10.5px] text-fg-subtle">
            {t("shortcuts.escCancel")}
          </p>
          {error && (
            <p role="alert" className="mt-1 text-[11px] text-danger">
              {t(`shortcuts.errors.${error}`)}
            </p>
          )}
        </div>
      )}

      <p className="text-[10.5px] leading-relaxed text-fg-subtle">
        {t("shortcuts.settingsHint", {
          combo: formatShortcut(bindings.showHelp, mac),
        })}
      </p>
    </Section>
  );
}
