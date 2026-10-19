import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
} from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useVoiceStatus } from "@/hooks/useVoiceStatus";

function HoverVolumePanel({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="absolute bottom-full left-0 z-50 hidden pb-2 group-hover:block group-focus-within:block">
      <div className="w-56 max-w-[calc(100vw-6.5rem)] rounded-panel border border-line-control bg-ink-900 p-3 shadow-panel">
        <div className="flex items-baseline gap-2">
          <span className="text-micro font-medium text-fg">{label}</span>
          <span className="ml-auto font-mono text-data text-fg-muted">
            {Math.round(value * 100)}%
          </span>
        </div>
        <Slider
          className="mt-2"
          aria-label={label}
          value={[value * 100]}
          min={0}
          max={max * 100}
          step={1}
          onValueChange={([v]) => onChange(v / 100)}
        />
        {value === 0 && (
          <p className="mt-1.5 text-data text-danger">{t("userbar.zeroMute")}</p>
        )}
      </div>
    </div>
  );
}

export function VoiceDock({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const {
    self,
    selfTalking,
    pttMode,
    selfMuted,
    selfDeafened,
    channels,
    micGain,
    outputVolume,
    setSelfMute,
    setSelfDeaf,
    setTransmitting,
    setMicGain,
    setOutputVolume,
    leaveVoice,
  } = useAppStore();
  const status = useVoiceStatus();
  const rootChannelId = Object.values(channels).find((c) => c.parentId < 0)?.id ?? 0;

  // PTT 模式：按住空格说话（输入框聚焦时不触发）
  useEffect(() => {
    if (pttMode !== "ptt") return;
    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTyping()) {
        e.preventDefault();
        setTransmitting(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setTransmitting(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pttMode, setTransmitting]);

  if (!self) return null;

  const inLobby = self.channelId === rootChannelId;

  return (
    <div
      data-testid="voice-dock"
      className="relative z-30 flex min-h-[var(--dock-h-mobile)] shrink-0 items-center gap-2 border-t border-line bg-ink-900 px-3 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 md:w-[200px]">
        <UserAvatar name={self.name} size={32} talking={selfTalking} />
        <div className="hidden min-w-0 sm:block">
          <div className="truncate text-ui font-semibold leading-tight text-fg">
            {self.name}
          </div>
          <div className="truncate text-data text-fg-subtle" aria-live="polite">
            {status}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1">
        <div className="group relative">
          <IconButton
            label={selfMuted ? t("userbar.unmute") : t("userbar.mute")}
            aria-pressed={!selfMuted}
            data-testid="voice-mute"
            onClick={() => setSelfMute(!selfMuted)}
            className={cn(
              "size-11 md:size-10",
              selfMuted ? "text-danger hover:text-danger-soft" : "text-fg",
            )}
          >
            {selfMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </IconButton>
          <HoverVolumePanel
            label={t("userbar.micLevel")}
            value={micGain}
            max={2}
            onChange={setMicGain}
          />
        </div>

        <div className="group relative">
          <IconButton
            label={selfDeafened ? t("userbar.undeafen") : t("userbar.deafen")}
            aria-pressed={!selfDeafened}
            data-testid="voice-deafen"
            onClick={() => setSelfDeaf(!selfDeafened)}
            className={cn(
              "size-11 md:size-10",
              selfDeafened ? "text-danger hover:text-danger-soft" : "text-fg",
            )}
          >
            {selfDeafened ? (
              <HeadphoneOff className="size-5" />
            ) : (
              <Headphones className="size-5" />
            )}
          </IconButton>
          <HoverVolumePanel
            label={t("userbar.outputLevel")}
            value={outputVolume}
            max={1.5}
            onChange={setOutputVolume}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={inLobby}
          onClick={leaveVoice}
          data-testid="voice-leave"
          aria-label={inLobby ? t("userbar.inLobby") : t("userbar.leave")}
          className="size-11 border-danger/40 bg-danger/10 p-0 text-danger hover:border-danger/60 hover:bg-danger/15 hover:text-danger-soft"
        >
          <PhoneOff className="size-5" />
        </Button>

        <IconButton
          label={t("userbar.settings")}
          tooltip={t("userbar.settings")}
          data-testid="voice-settings"
          onClick={onOpenSettings}
          className="size-11"
        >
          <Settings className="size-5" />
        </IconButton>
      </div>
    </div>
  );
}
