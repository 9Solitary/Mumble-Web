import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Check,
  Info,
  Keyboard,
  Languages,
  Mic,
  Radio,
  RotateCcw,
} from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { useShortcutStore } from "@/store/shortcutStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AudioTab } from "@/components/settings/AudioTab";
import { VoiceTab } from "@/components/settings/VoiceTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { DiagnosticsTab } from "@/components/settings/DiagnosticsTab";
import { ShortcutsTab } from "@/components/settings/ShortcutsTab";
import { AboutTab } from "@/components/settings/AboutTab";
import { useAudioDevices } from "@/components/settings/devices";
import {
  DEFAULT_CONTINUOUS_TRANSMIT,
  DEFAULT_INPUT_DEVICE_ID,
  DEFAULT_LOW_LATENCY_BUFFER,
  DEFAULT_MIC_GAIN,
  DEFAULT_OUTPUT_DEVICE_ID,
  DEFAULT_OUTPUT_VOLUME,
  DEFAULT_PTT_MODE,
  DEFAULT_VAD_THRESHOLD,
} from "@/lib/settingsDefaults";
import { toastSuccess } from "@/lib/toast";

export type SettingsTab =
  | "audio"
  | "voice"
  | "shortcuts"
  | "appearance"
  | "diagnostics"
  | "about";
type Tab = SettingsTab;

const TAB_ORDER: Tab[] = [
  "audio",
  "voice",
  "shortcuts",
  "appearance",
  "diagnostics",
  "about",
];

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "audio",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
}) {
  const { t } = useTranslation();
  const {
    client,
    inputDeviceId,
    outputDeviceId,
    micGain,
    outputVolume,
    lowLatencyBuffer,
    pttMode,
    vadThreshold,
    continuousTransmit,
    setInputDevice,
    setOutputDevice,
    setVadThreshold,
    setContinuousTransmit,
    setPttMode,
    setMicGain,
    setOutputVolume,
    setLowLatencyBuffer,
  } = useAppStore();
  const shortcutBindings = useShortcutStore((s) => s.bindings);
  const resetShortcuts = useShortcutStore((s) => s.resetAll);
  const { inputs, outputs, permissionNeeded, requestPermission } = useAudioDevices(open);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [level, setLevel] = useState(0);
  const [resetDone, setResetDone] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setLevel(client.getMicLevel()), 100);
    return () => window.clearInterval(timer);
  }, [open, client]);

  useEffect(
    () => () => {
      if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  // 设置值变化即视为已保存；短暂展示反馈后回到常驻说明。
  const settingsSnapshot = JSON.stringify({
    inputDeviceId,
    outputDeviceId,
    micGain,
    outputVolume,
    lowLatencyBuffer,
    pttMode,
    vadThreshold,
    continuousTransmit,
    shortcuts: shortcutBindings,
  });
  const previousSnapshot = useRef(settingsSnapshot);
  useEffect(() => {
    if (previousSnapshot.current === settingsSnapshot) return;
    previousSnapshot.current = settingsSnapshot;
    // 外部设置变更后的 UI 反馈，不是渲染期派生状态。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(true);
    const timer = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timer);
  }, [settingsSnapshot]);

  const flashResetDone = () => {
    setResetDone(true);
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setResetDone(false), 2200);
  };

  const reset = () => {
    setInputDevice(DEFAULT_INPUT_DEVICE_ID);
    setOutputDevice(DEFAULT_OUTPUT_DEVICE_ID);
    setMicGain(DEFAULT_MIC_GAIN);
    setOutputVolume(DEFAULT_OUTPUT_VOLUME);
    setVadThreshold(DEFAULT_VAD_THRESHOLD);
    setContinuousTransmit(DEFAULT_CONTINUOUS_TRANSMIT);
    setLowLatencyBuffer(DEFAULT_LOW_LATENCY_BUFFER);
    setPttMode(DEFAULT_PTT_MODE);
    resetShortcuts();
    setResetOpen(false);
    flashResetDone();
    toastSuccess(t("settings.resetDone"));
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "audio", label: t("settings.tabs.audio"), icon: <Mic className="size-4" /> },
    { id: "voice", label: t("settings.tabs.voice"), icon: <Radio className="size-4" /> },
    {
      id: "shortcuts",
      label: t("settings.tabs.shortcuts"),
      icon: <Keyboard className="size-4" />,
    },
    {
      id: "appearance",
      label: t("settings.tabs.appearance"),
      icon: <Languages className="size-4" />,
    },
    { id: "diagnostics", label: t("settings.tabs.diagnostics"), icon: <Activity className="size-4" /> },
    { id: "about", label: t("settings.tabs.about"), icon: <Info className="size-4" /> },
  ];

  const activateTab = (next: Tab) => {
    setTab(next);
    // 等 DOM 更新后再聚焦，键盘切换时焦点不会丢。
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % TAB_ORDER.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TAB_ORDER.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    activateTab(TAB_ORDER[nextIndex]);
  };

  const statusText = resetDone
    ? t("settings.resetDone")
    : saved
      ? t("settings.saved")
      : t("settings.autoSaved");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            tabRefs.current[tab]?.focus();
          }}
          className="settings-dialog grid max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-dialog border-line-control bg-ink-900 p-0 text-fg sm:max-w-none"
        >
          <DialogHeader className="flex h-14 shrink-0 flex-row items-center border-b border-line px-5 text-left sm:px-6">
            <DialogTitle className="text-title font-semibold leading-tight tracking-tight text-fg">
              {t("settings.title")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[208px_minmax(0,1fr)] md:grid-rows-1">
            <nav
              role="tablist"
              aria-label={t("settings.title")}
              aria-orientation="vertical"
              data-testid="settings-tabs"
              className="flex gap-1 overflow-x-auto border-b border-line p-2 md:flex-col md:border-b-0 md:border-r md:p-3"
            >
              {tabs.map((item, index) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      tabRefs.current[item.id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`settings-tab-${item.id}`}
                    aria-selected={active}
                    aria-controls={`settings-panel-${item.id}`}
                    tabIndex={active ? 0 : -1}
                    data-testid={`settings-tab-${item.id}`}
                    onClick={() => setTab(item.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-ui transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/60 ${
                      active
                        ? "bg-mint/10 text-fg shadow-rail"
                        : "text-fg-subtle hover:bg-fg/[0.04] hover:text-fg-muted"
                    }`}
                  >
                    <span className={active ? "text-mint" : "text-fg-subtle"} aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div
              role="tabpanel"
              id={`settings-panel-${tab}`}
              aria-labelledby={`settings-tab-${tab}`}
              data-testid="settings-panel"
              className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 outline-none md:px-6 md:py-5"
            >
              {tab === "audio" && (
                <AudioTab
                  inputs={inputs}
                  outputs={outputs}
                  permissionNeeded={permissionNeeded}
                  requestPermission={() => void requestPermission()}
                  level={level}
                />
              )}
              {tab === "voice" && <VoiceTab level={level} />}
              {tab === "shortcuts" && <ShortcutsTab />}
              {tab === "appearance" && <AppearanceTab />}
              {tab === "diagnostics" && <DiagnosticsTab />}
              {tab === "about" && <AboutTab onClose={() => onOpenChange(false)} />}
            </div>
          </div>

          <DialogFooter className="flex min-h-14 shrink-0 flex-row items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="settings-reset"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t("settings.reset")}
              </Button>
              <span
                className="hidden min-w-0 items-center gap-1.5 truncate text-[10.5px] text-fg-subtle sm:flex"
                aria-live="polite"
                aria-atomic="true"
              >
                <Check className="size-3.5 shrink-0 text-mint" aria-hidden="true" />
                {statusText}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              data-testid="settings-done"
              onClick={() => onOpenChange(false)}
            >
              {t("settings.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.resetConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.resetConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-reset-confirm"
              onClick={reset}
              className="border-0 bg-danger text-danger-on hover:bg-danger-strong"
            >
              {t("settings.resetConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
