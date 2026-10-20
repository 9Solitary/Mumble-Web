import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Settings } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { useShortcutStore } from "@/store/shortcutStore";
import { formatAriaShortcut } from "@/lib/shortcuts";
import { useRtt } from "@/hooks/useRtt";
import { useVoiceModeLabel, useVoiceStatus } from "@/hooks/useVoiceStatus";
import { UserAvatar } from "@/components/UserAvatar";
import { VoiceVolumePanel } from "@/components/VoiceVolumePanel";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

// 桌面端左下语音卡：第一行语音状态/发言方式/挂断，第二行自己/麦克风/耳机/设置。
export function VoicePanel({
  onOpenSettings,
  onOpenVoiceSettings,
}: {
  onOpenSettings: () => void;
  onOpenVoiceSettings: () => void;
}) {
  const { t } = useTranslation();
  const [volumePanel, setVolumePanel] = useState<"mic" | "output" | null>(null);
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
    connState,
  } = useAppStore();
  const status = useVoiceStatus();
  const modeLabel = useVoiceModeLabel();
  const rtt = useRtt();
  const muteShortcut = useShortcutStore((s) => s.bindings.toggleMute);
  const deafenShortcut = useShortcutStore((s) => s.bindings.toggleDeafen);
  const rootChannelId = Object.values(channels).find((c) => c.parentId < 0)?.id ?? 0;

  if (!self) return null;

  const inLobby = self.channelId === rootChannelId;
  const reconnecting = connState === "reconnecting";
  const channelName = channels[self.channelId]?.name;
  const statusLine = [
    t("voicePanel.connected"),
    channelName,
    rtt != null ? t("units.ms", { value: Math.round(rtt) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const modeAria = t("voicePanel.modeAria", { mode: modeLabel });

  // 同一时刻只允许一个音量面板；鼠标点击留下的焦点不能让它常驻。
  const closeVolume = (panel: "mic" | "output") => {
    setVolumePanel((current) => (current === panel ? null : current));
  };

  return (
    <div
      data-testid="voice-panel"
      className="flex w-full shrink-0 flex-col gap-2 border-t border-line bg-ink-900 px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            reconnecting ? "bg-amber" : "bg-mint",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-data text-fg-subtle" title={statusLine}>
          {statusLine}
        </span>
        <button
          type="button"
          data-testid="voice-mode"
          onClick={onOpenVoiceSettings}
          aria-label={modeAria}
          title={modeAria}
          className="max-w-[116px] shrink-0 truncate rounded px-1.5 py-0.5 text-data text-mint transition-colors hover:bg-ink-800 hover:text-mint-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/60"
        >
          {modeLabel}
        </button>
        <Button
          type="button"
          variant="outline"
          disabled={inLobby}
          onClick={leaveVoice}
          data-testid="voice-leave"
          aria-label={inLobby ? t("userbar.inLobby") : t("userbar.leave")}
          className="size-8 shrink-0 border-danger/40 bg-danger/10 p-0 text-danger hover:border-danger/60 hover:bg-danger/15 hover:text-danger-soft"
        >
          <PhoneOff className="size-4" />
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-1">
        <UserAvatar name={self.name} size={28} talking={selfTalking} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui font-semibold leading-tight text-fg">
            {self.name}
          </div>
          <div className="truncate text-data text-fg-subtle">{status}</div>
        </div>

        <div
          className="relative"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setVolumePanel("mic");
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") closeVolume("mic");
          }}
          onFocusCapture={() => setVolumePanel("mic")}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              closeVolume("mic");
            }
          }}
        >
          <IconButton
            label={selfMuted ? t("userbar.unmute") : t("userbar.mute")}
            aria-pressed={selfMuted}
            aria-keyshortcuts={formatAriaShortcut(muteShortcut)}
            data-testid="voice-mute"
            onClick={() => {
              setSelfMute(!selfMuted);
              setVolumePanel(null);
            }}
            size="sm"
            className={cn(
              "size-8",
              selfMuted ? "text-danger hover:text-danger-soft" : "text-fg",
            )}
          >
            {selfMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </IconButton>
          <VoiceVolumePanel
            open={volumePanel === "mic"}
            label={t("userbar.micLevel")}
            value={micGain}
            max={2}
            onChange={setMicGain}
            icon={<Mic className="size-3.5" />}
            testId="voice-panel-mic-volume"
          />
        </div>

        <div
          className="relative"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setVolumePanel("output");
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") closeVolume("output");
          }}
          onFocusCapture={() => setVolumePanel("output")}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              closeVolume("output");
            }
          }}
        >
          <IconButton
            label={selfDeafened ? t("userbar.undeafen") : t("userbar.deafen")}
            aria-pressed={selfDeafened}
            aria-keyshortcuts={formatAriaShortcut(deafenShortcut)}
            data-testid="voice-deafen"
            onClick={() => {
              setSelfDeaf(!selfDeafened);
              setVolumePanel(null);
            }}
            size="sm"
            className={cn(
              "size-8",
              selfDeafened ? "text-danger hover:text-danger-soft" : "text-fg",
            )}
          >
            {selfDeafened ? (
              <HeadphoneOff className="size-4" />
            ) : (
              <Headphones className="size-4" />
            )}
          </IconButton>
          <VoiceVolumePanel
            open={volumePanel === "output"}
            label={t("userbar.outputLevel")}
            value={outputVolume}
            max={1.5}
            onChange={setOutputVolume}
            icon={<Headphones className="size-3.5" />}
            testId="voice-panel-output-volume"
          />
        </div>

        <IconButton
          label={t("userbar.settings")}
          tooltip={t("userbar.settings")}
          tooltipHoverOnly
          data-testid="voice-settings"
          onClick={onOpenSettings}
          size="sm"
          className="size-8"
        >
          <Settings className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
