import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "./UserAvatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneOff,
  Radio,
  Keyboard,
} from "lucide-react";

function BarButton({
  active,
  danger,
  onClick,
  tooltip,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
            danger
              ? "bg-[#ed4245] text-white hover:bg-[#c93437]"
              : active
                ? "bg-[#4e5058] text-white"
                : "text-[#b5bac1] hover:bg-[#4e5058] hover:text-white"
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-[#111214] text-[#dbdee1] border-[#3f4147]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function UserBar() {
  const {
    self,
    talking,
    transmitting,
    micReady,
    micError,
    pttMode,
    selfMuted,
    selfDeafened,
    setSelfMute,
    setSelfDeaf,
    setPttMode,
    setTransmitting,
    disconnect,
  } = useAppStore();

  const selfTalking = self ? !!talking[self.session] : false;

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

  const isTransmitting =
    micReady && !selfMuted && !selfDeafened && (pttMode === "open" || transmitting);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-[60px] bg-[#232428] px-3 flex items-center gap-2 shrink-0">
        <UserAvatar name={self.name} size={36} talking={selfTalking} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{self.name}</div>
          <div className="text-[11px] text-[#949ba4] truncate">
            {micError
              ? micError
              : !micReady
                ? "麦克风初始化中…"
                : isTransmitting
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

        <BarButton
          active={!selfMuted}
          onClick={() => setSelfMute(!selfMuted)}
          tooltip={selfMuted ? "取消静音" : "静音"}
        >
          {selfMuted ? <MicOff className="w-4 h-4 text-[#fa777c]" /> : <Mic className="w-4 h-4" />}
        </BarButton>

        <BarButton
          active={!selfDeafened}
          onClick={() => setSelfDeaf(!selfDeafened)}
          tooltip={selfDeafened ? "取消闭麦" : "闭麦（同时静音）"}
        >
          {selfDeafened ? (
            <HeadphoneOff className="w-4 h-4 text-[#fa777c]" />
          ) : (
            <Headphones className="w-4 h-4" />
          )}
        </BarButton>

        <BarButton danger onClick={disconnect} tooltip="断开连接">
          <PhoneOff className="w-4 h-4" />
        </BarButton>
      </div>
    </TooltipProvider>
  );
}
