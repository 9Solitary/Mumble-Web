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
import { useShortcutStore } from "@/store/shortcutStore";
import { formatAriaShortcut } from "@/lib/shortcuts";
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
    <div className="absolute bottom-full left-3 z-50 hidden pb-2 group-hover:block group-focus-within:block">
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
    selfMuted,
    selfDeafened,
    channels,
    micGain,
    outputVolume,
    setSelfMute,
    setSelfDeaf,
    setMicGain,
    setOutputVolume,
    leaveVoice,
  } = useAppStore();
  const status = useVoiceStatus();
  const muteShortcut = useShortcutStore((s) => s.bindings.toggleMute);
  const deafenShortcut = useShortcutStore((s) => s.bindings.toggleDeafen);
  const rootChannelId = Object.values(channels).find((c) => c.parentId < 0)?.id ?? 0;

  if (!self) return null;

  const inLobby = self.channelId === rootChannelId;
  const channelName = channels[self.channelId]?.name ?? self.name;

  return (
    <div
      data-testid="voice-dock"
      className="relative z-30 flex min-h-[var(--dock-h-mobile)] shrink-0 items-center gap-2 border-t border-line bg-ink-900 px-3 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="shrink-0" title={`${self.name} · ${status}`}>
          <UserAvatar name={self.name} size={32} talking={selfTalking} />
        </div>
        <div
          data-testid="voice-dock-status"
          className="hidden min-w-0 flex-1 min-[390px]:block"
        >
          <div className="truncate text-ui font-semibold leading-tight text-fg">
            {channelName}
          </div>
          <div className="truncate text-data text-fg-subtle" aria-live="polite">
            {status}
          </div>
        </div>
        <span className="sr-only min-[390px]:hidden">
          {t("shell.selfStatus", { name: self.name, status })}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div className="group">
          <IconButton
            label={selfMuted ? t("userbar.unmute") : t("userbar.mute")}
            aria-pressed={selfMuted}
            aria-keyshortcuts={formatAriaShortcut(muteShortcut)}
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

        <div className="group">
          <IconButton
            label={selfDeafened ? t("userbar.undeafen") : t("userbar.deafen")}
            aria-pressed={selfDeafened}
            aria-keyshortcuts={formatAriaShortcut(deafenShortcut)}
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
          tooltipHoverOnly
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
