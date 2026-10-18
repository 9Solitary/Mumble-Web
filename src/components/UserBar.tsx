import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "./UserAvatar";
import { SettingsDialog } from "./SettingsDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneOff,
  Radio,
  Keyboard,
  Settings,
} from "lucide-react";

function BarButton({
  active,
  danger,
  disabled,
  onClick,
  tooltip,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors shrink-0 ${
        disabled
          ? "text-[#4e5058] cursor-not-allowed"
          : danger
            ? "bg-[#ed4245] text-white hover:bg-[#c93437]"
            : active
              ? "bg-[#4e5058] text-white"
              : "text-[#b5bac1] hover:bg-[#4e5058] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="top" className="bg-[#111214] text-[#dbdee1] border-[#3f4147]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// 悬浮音量面板：悬停在按钮上时向上弹出滑动条（pb-2 桥接间隙，移入面板不消失）
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
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 hidden group-hover:block pb-2 z-50">
      <div className="w-40 rounded-md bg-[#111214] border border-[#3f4147] p-3 shadow-xl">
        <div className="flex items-center gap-1.5 text-xs text-[#b5bac1]">
          <span className="font-bold uppercase">{label}</span>
          <span className="ml-auto text-[#949ba4]">{Math.round(value * 100)}%</span>
        </div>
        <Slider
          className="mt-2"
          value={[value * 100]}
          min={0}
          max={max * 100}
          step={5}
          onValueChange={([v]) => onChange(v / 100)}
        />
      </div>
    </div>
  );
}

export function UserBar() {
  const {
    self,
    selfTalking,
    micReady,
    micError,
    pttMode,
    selfMuted,
    selfDeafened,
    channels,
    micGain,
    outputVolume,
    setSelfMute,
    setSelfDeaf,
    setPttMode,
    setTransmitting,
    setMicGain,
    setOutputVolume,
    leaveVoice,
  } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootChannelId =
    Object.values(channels).find((c) => c.parentId < 0)?.id ?? 0;

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

  return (
    <TooltipProvider delayDuration={200}>
      {/* 固定 240px：头像 36 + 5 按钮 28 + gap-1 + px-3，用户名 truncate 自适应剩余宽度 */}
      <div className="h-[60px] w-60 bg-[#232428] px-3 flex items-center gap-1 shrink-0">
        <UserAvatar name={self.name} size={36} talking={selfTalking} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{self.name}</div>
          <div className="text-[11px] text-[#949ba4] truncate">
            {micError
              ? micError
              : !micReady
                ? "麦克风初始化中…"
                : selfTalking
                  ? "正在发言"
                  : pttMode === "ptt"
                    ? "按住空格说话"
                    : "自由发言中"}
          </div>
        </div>

        {/* PTT 模式切换 */}
        <BarButton
          active={pttMode === "open"}
          onClick={() => setPttMode(pttMode === "ptt" ? "open" : "ptt")}
          tooltip={pttMode === "ptt" ? "切换为自由发言" : "切换为按键说话（空格）"}
        >
          {pttMode === "ptt" ? <Keyboard className="w-4 h-4" /> : <Radio className="w-4 h-4" />}
        </BarButton>

        <div className="relative group">
          <BarButton
            active={!selfMuted}
            onClick={() => setSelfMute(!selfMuted)}
          >
            {selfMuted ? <MicOff className="w-4 h-4 text-[#fa777c]" /> : <Mic className="w-4 h-4" />}
          </BarButton>
          <HoverVolumePanel
            label={selfMuted ? "麦克风音量（已静音）" : "麦克风音量"}
            value={micGain}
            max={2}
            onChange={setMicGain}
          />
        </div>

        <div className="relative group">
          <BarButton
            active={!selfDeafened}
            onClick={() => setSelfDeaf(!selfDeafened)}
          >
            {selfDeafened ? (
              <HeadphoneOff className="w-4 h-4 text-[#fa777c]" />
            ) : (
              <Headphones className="w-4 h-4" />
            )}
          </BarButton>
          <HoverVolumePanel
            label={selfDeafened ? "耳机音量（已闭麦）" : "耳机音量"}
            value={outputVolume}
            max={1.5}
            onChange={setOutputVolume}
          />
        </div>

        <BarButton onClick={() => setSettingsOpen(true)} tooltip="设置">
          <Settings className="w-4 h-4" />
        </BarButton>

        <BarButton
          danger
          disabled={self.channelId === rootChannelId}
          onClick={leaveVoice}
          tooltip={
            self.channelId === rootChannelId
              ? "已在大厅"
              : "离开语音（回到大厅）"
          }
        >
          <PhoneOff className="w-4 h-4" />
        </BarButton>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
  );
}
