import { useEffect, useState } from "react";
import { useAppStore } from "@/store/appStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mic, Volume2, Radio, LogOut } from "lucide-react";

const DEFAULT_DEVICE = "default"; // Radix Select 不允许空字符串 value

function useAudioDevices(open: boolean) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const load = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setInputs(devs.filter((d) => d.kind === "audioinput"));
        setOutputs(devs.filter((d) => d.kind === "audiooutput"));
      } catch {
        /* 枚举失败保持空列表 */
      }
    };
    void load();
    navigator.mediaDevices.addEventListener?.("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", load);
    };
  }, [open]);
  return { inputs, outputs };
}

function deviceLabel(d: MediaDeviceInfo, i: number): string {
  return d.label || `设备 ${i + 1}`;
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    client,
    inputDeviceId,
    outputDeviceId,
    vadThreshold,
    pttMode,
    setInputDevice,
    setOutputDevice,
    setVadThreshold,
    setPttMode,
    disconnect,
  } = useAppStore();
  const { inputs, outputs } = useAudioDevices(open);
  const [level, setLevel] = useState(0);

  // 实时麦克风电平（校准阈值用）
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setLevel(client.getMicLevel());
    }, 100);
    return () => window.clearInterval(timer);
  }, [open, client]);

  const levelPct = Math.min(100, level * 100);
  const thresholdPct = vadThreshold * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#313338] border-[#1e1f22] text-[#dbdee1] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">设置</DialogTitle>
          <DialogDescription className="text-[#949ba4]">
            音频设备与发言方式（保存在本机浏览器）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 音频输入 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs font-bold uppercase text-[#b5bac1]">
              <Mic className="w-4 h-4" /> 输入设备
            </Label>
            <Select
              value={inputDeviceId || DEFAULT_DEVICE}
              onValueChange={(v) =>
                setInputDevice(v === DEFAULT_DEVICE ? "" : v)
              }
            >
              <SelectTrigger className="bg-[#1e1f22] border-[#1e1f22] text-[#dbdee1]">
                <SelectValue placeholder="系统默认" />
              </SelectTrigger>
              <SelectContent className="bg-[#111214] border-[#3f4147] text-[#dbdee1]">
                <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
                {inputs.map((d, i) => (
                  <SelectItem key={d.deviceId || i} value={d.deviceId}>
                    {deviceLabel(d, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 电平条：背景条 + 阈值标记 */}
            <div className="relative h-2 rounded bg-[#1e1f22] overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-[#23a55a] transition-[width] duration-100"
                style={{ width: `${levelPct}%` }}
              />
              {thresholdPct > 0 && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-[#fee75c]"
                  style={{ left: `${thresholdPct}%` }}
                />
              )}
            </div>
            <p className="text-[11px] text-[#6d6f78]">
              当前电平 {Math.round(levelPct)}%
              {thresholdPct > 0 && ` · 阈值 ${Math.round(thresholdPct)}%`}
            </p>
          </div>

          {/* 音频输出 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs font-bold uppercase text-[#b5bac1]">
              <Volume2 className="w-4 h-4" /> 输出设备
            </Label>
            <Select
              value={outputDeviceId || DEFAULT_DEVICE}
              onValueChange={(v) =>
                setOutputDevice(v === DEFAULT_DEVICE ? "" : v)
              }
            >
              <SelectTrigger className="bg-[#1e1f22] border-[#1e1f22] text-[#dbdee1]">
                <SelectValue placeholder="系统默认" />
              </SelectTrigger>
              <SelectContent className="bg-[#111214] border-[#3f4147] text-[#dbdee1]">
                <SelectItem value={DEFAULT_DEVICE}>系统默认</SelectItem>
                {outputs.map((d, i) => (
                  <SelectItem key={d.deviceId || i} value={d.deviceId}>
                    {deviceLabel(d, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 发言方式 */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs font-bold uppercase text-[#b5bac1]">
              <Radio className="w-4 h-4" /> 发言方式
            </Label>
            <RadioGroup
              value={pttMode}
              onValueChange={(v) => setPttMode(v as "ptt" | "open")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="ptt" id="tx-ptt" />
                <Label htmlFor="tx-ptt" className="text-sm">
                  按键说话（空格）
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="open" id="tx-open" />
                <Label htmlFor="tx-open" className="text-sm">
                  自由发言
                </Label>
              </div>
            </RadioGroup>
            {pttMode === "open" && (
              <div className="pt-1">
                <div className="flex justify-between text-xs text-[#949ba4]">
                  <span>触发阈值</span>
                  <span>
                    {thresholdPct <= 0
                      ? "持续传输"
                      : `${Math.round(thresholdPct)}%`}
                  </span>
                </div>
                <Slider
                  className="mt-2"
                  value={[thresholdPct]}
                  min={0}
                  max={50}
                  step={1}
                  onValueChange={([v]) => setVadThreshold(v / 100)}
                />
                <p className="mt-1 text-[11px] text-[#6d6f78]">
                  电平超过阈值才开始发送，低于阈值约 0.4 秒后停止；拉到 0
                  为持续传输。
                </p>
              </div>
            )}
          </div>

          {/* 退出登录 */}
          <div className="border-t border-[#3f4147] pt-4">
            <Button
              variant="ghost"
              className="w-full bg-[#ed4245]/10 text-[#fa777c] hover:bg-[#ed4245]/20 hover:text-[#fa777c]"
              onClick={() => {
                onOpenChange(false);
                disconnect();
              }}
            >
              <LogOut className="w-4 h-4 mr-2" />
              退出登录（返回连接页）
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
