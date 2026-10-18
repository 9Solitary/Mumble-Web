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
import {
  Mic,
  Volume2,
  Radio,
  LogOut,
  Activity,
  Info,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";
import { exportJSON, getSession } from "@/lib/diagnostics";
import { getLatestStats, type RtcStatsSnapshot } from "@/lib/rtcStats";

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

function fmtMs(v: number | null): string {
  return v == null ? "-" : `${Math.round(v)} ms`;
}

// 连接诊断：折叠展示 RTC 指标 / 状态 / 会话信息，支持一键复制诊断 JSON。
// 面板打开期间每 1s 刷新一次（rtcStats 本身每 5s 采集）。
function DiagnosticsSection() {
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<RtcStatsSnapshot>(getLatestStats);
  const [session, setSession] = useState(getSession);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const timer = window.setInterval(() => {
      setStats(getLatestStats());
      setSession(getSession());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expanded]);

  const copyDiag = async () => {
    try {
      await navigator.clipboard.writeText(exportJSON());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  const rows: [string, string][] = [
    ["RTT", fmtMs(stats.rttMs)],
    ["抖动缓冲延迟", fmtMs(stats.jitterBufferDelayMs)],
    [
      "丢包率",
      stats.lossPct == null ? "-" : `${stats.lossPct.toFixed(1)}%`,
    ],
    ["RTC 状态", stats.connectionState],
    ["ICE 状态", stats.iceConnectionState],
    ["重连次数", "-"], // 阶段 2 才实现重连
    ["会话 ID", session.sid || "-"],
    ["版本", session.version || "-"],
  ];

  return (
    <div className="border-t border-[#3f4147] pt-4 space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-xs font-bold uppercase text-[#b5bac1] hover:text-white"
        onClick={() => setExpanded((v) => !v)}
      >
        <Activity className="w-4 h-4" /> 连接诊断
        <ChevronDown
          className={`w-4 h-4 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="space-y-2">
          <div className="rounded-md bg-[#1e1f22] px-3 py-2 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5">
                <span className="text-[#949ba4]">{k}</span>
                <span className="text-[#dbdee1] font-mono">{v}</span>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full bg-[#5865f2]/10 text-[#b5bac1] hover:bg-[#5865f2]/20 hover:text-white"
            onClick={() => void copyDiag()}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2" /> 已复制
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" /> 复制诊断信息
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// 关于：显示代理版本（优先 hello 信封下发的 version，缺失时回退 /api/version）
function AboutSection() {
  const [version, setVersion] = useState(() => getSession().version);

  useEffect(() => {
    if (version) return;
    let cancelled = false;
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.version) setVersion(String(d.version));
      })
      .catch(() => {
        /* 接口不可用时显示未知 */
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <div className="border-t border-[#3f4147] pt-4">
      <Label className="flex items-center gap-2 text-xs font-bold uppercase text-[#b5bac1]">
        <Info className="w-4 h-4" /> 关于
      </Label>
      <p className="mt-1 text-xs text-[#6d6f78]">
        Mumble Web · 代理版本{" "}
        <span className="font-mono">{version || "未知"}</span>
      </p>
    </div>
  );
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

        {/* min-w-0：DialogContent 是 grid，grid 子项默认 min-width:auto 会被长设备名撑破弹窗 */}
        <div className="space-y-5 min-w-0">
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
              <SelectTrigger className="w-full bg-[#1e1f22] border-[#1e1f22] text-[#dbdee1]">
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
              <SelectTrigger className="w-full bg-[#1e1f22] border-[#1e1f22] text-[#dbdee1]">
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

          {/* 连接诊断 */}
          <DiagnosticsSection />

          {/* 关于 */}
          <AboutSection />

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
