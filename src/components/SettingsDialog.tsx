import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Info,
  Languages,
  LogOut,
  Mic,
  Radio,
} from "lucide-react";
import { setLocale, type Locale } from "@/i18n";
import { exportJSON, getSession } from "@/lib/diagnostics";
import { getLatestStats, type RtcStatsSnapshot } from "@/lib/rtcStats";
import { apiUrl } from "@/lib/backend";
import {
  DEFAULT_MANUAL_THRESHOLD_DB,
  THRESHOLD_MAX_DB,
  THRESHOLD_MIN_DB,
  clampThresholdDb,
  dbToPercent,
  dbToRms,
  rmsToDb,
  roundDb,
} from "@/lib/audioLevel";

const DEFAULT_DEVICE = "default"; // Radix Select 不允许空字符串 value

function useAudioDevices(open: boolean) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [permissionNeeded, setPermissionNeeded] = useState(
    !navigator.mediaDevices?.enumerateDevices,
  );

  const load = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermissionNeeded(true);
      return;
    }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      // 未授权时 deviceId 为空，Radix Select 会直接抛错；这里过滤掉占位设备。
      const real = devs.filter(
        (d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
      );
      setInputs(real.filter((d) => d.kind === "audioinput"));
      setOutputs(real.filter((d) => d.kind === "audiooutput"));
      setPermissionNeeded(real.length === 0);
    } catch {
      setPermissionNeeded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // 设备枚举是外部系统订阅；枚举完成后才 setState，不属于同步渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, [open, load]);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await load();
    } catch {
      setPermissionNeeded(true);
    }
  }, [load]);

  return { inputs, outputs, permissionNeeded, requestPermission };
}

function deviceLabel(device: MediaDeviceInfo, index: number, fallback: string): string {
  return device.label || fallback.replace("{{n}}", String(index + 1));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line py-4 last:border-b-0">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-fg-subtle">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InlineRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
      <span className="text-[13px] font-medium leading-tight text-fg">
        {label}
      </span>
      <div className="w-full md:max-w-[340px]">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  help,
  children,
}: {
  label: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid gap-2 md:grid-cols-[190px_minmax(0,1fr)] md:gap-6 ${
        help ? "md:items-start" : "md:items-center"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-tight text-fg">{label}</div>
        {help && <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">{help}</p>}
      </div>
      <div className="min-w-0 w-full md:ml-auto md:max-w-[340px]">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-lg border border-line-strong bg-ink-950 p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={disabled}
          aria-pressed={value === option.value}
          className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors disabled:opacity-40 ${
            value === option.value
              ? "bg-ink-700 text-fg"
              : "text-fg-subtle hover:text-fg-muted"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function LevelMeter({ level, thresholdDb }: { level: number; thresholdDb?: number }) {
  const levelPct = dbToPercent(rmsToDb(level));
  const thresholdPct =
    thresholdDb == null ? null : dbToPercent(clampThresholdDb(thresholdDb));

  return (
    <div className="relative h-2 overflow-hidden rounded-full border border-line bg-ink-950">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint-deep to-mint transition-[width] duration-100"
        style={{ width: `${levelPct}%` }}
      />
      {thresholdPct != null && (
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-amber"
          style={{ left: `${thresholdPct}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function AudioTab({
  inputs,
  outputs,
  permissionNeeded,
  requestPermission,
  level,
}: {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  permissionNeeded: boolean;
  requestPermission: () => void;
  level: number;
}) {
  const { t } = useTranslation();
  const {
    inputDeviceId,
    outputDeviceId,
    micGain,
    outputVolume,
    lowLatencyBuffer,
    setInputDevice,
    setOutputDevice,
    setMicGain,
    setOutputVolume,
    setLowLatencyBuffer,
  } = useAppStore();

  return (
    <div>
      <Section title={t("settings.audio.inputSection")}>
        <SettingRow label={t("settings.audio.input")}>
          <Select
            value={inputDeviceId || DEFAULT_DEVICE}
            onValueChange={(value) => setInputDevice(value === DEFAULT_DEVICE ? "" : value)}
          >
            <SelectTrigger className="w-full border-line-control bg-ink-800 text-fg">
              <SelectValue placeholder={t("settings.audio.defaultDevice")} />
            </SelectTrigger>
            <SelectContent className="border-line-control bg-ink-900 text-fg">
              <SelectItem value={DEFAULT_DEVICE}>{t("settings.audio.defaultDevice")}</SelectItem>
              {inputs.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {deviceLabel(device, index, t("settings.audio.deviceFallback"))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {permissionNeeded && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-amber-soft">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" />
              <div className="min-w-0">
                <p>{t("settings.audio.permissionNeeded")}</p>
                <button
                  type="button"
                  onClick={requestPermission}
                  className="mt-1 font-medium text-mint underline-offset-2 hover:underline"
                >
                  {t("settings.audio.grant")}
                </button>
              </div>
            </div>
          )}
        </SettingRow>

        <SettingRow label={t("settings.audio.level")} help={t("settings.audio.levelHelp")}>
          <LevelMeter level={level} />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-fg-subtle">
            <span>-60 dB</span>
            <span>-30</span>
            <span>0 dB</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {t("settings.audio.levelValue", { value: roundDb(rmsToDb(level)) })}
          </p>
        </SettingRow>

        <SettingRow label={t("settings.audio.gain")} help={t("settings.audio.gainHelp")}>
          <div className="flex items-center gap-3">
            <Slider
              aria-label={t("settings.audio.gain")}
              value={[micGain * 100]}
              min={0}
              max={200}
              step={1}
              onValueChange={([value]) => setMicGain(value / 100)}
            />
            <span className="min-w-10 text-right font-mono text-[11px] text-fg-muted">
              {Math.round(micGain * 100)}%
            </span>
          </div>
          {micGain === 0 && (
            <p className="mt-1 text-[10px] text-danger">{t("settings.audio.gainMuted")}</p>
          )}
        </SettingRow>
      </Section>

      <Section title={t("settings.audio.outputSection")}>
        <SettingRow label={t("settings.audio.output")}>
          <Select
            value={outputDeviceId || DEFAULT_DEVICE}
            onValueChange={(value) => setOutputDevice(value === DEFAULT_DEVICE ? "" : value)}
          >
            <SelectTrigger className="w-full border-line-control bg-ink-800 text-fg">
              <SelectValue placeholder={t("settings.audio.defaultDevice")} />
            </SelectTrigger>
            <SelectContent className="border-line-control bg-ink-900 text-fg">
              <SelectItem value={DEFAULT_DEVICE}>{t("settings.audio.defaultDevice")}</SelectItem>
              {outputs.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {deviceLabel(device, index, t("settings.audio.deviceFallback"))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow label={t("settings.audio.outputVolume")}>
          <div className="flex items-center gap-3">
            <Slider
              aria-label={t("settings.audio.outputVolume")}
              value={[outputVolume * 100]}
              min={0}
              max={150}
              step={1}
              onValueChange={([value]) => setOutputVolume(value / 100)}
            />
            <span className="min-w-10 text-right font-mono text-[11px] text-fg-muted">
              {Math.round(outputVolume * 100)}%
            </span>
          </div>
          {outputVolume === 0 && (
            <div className="mt-1 flex items-center gap-2 text-[10px] text-danger">
              <span>{t("settings.audio.outputMuted")}</span>
              <button
                type="button"
                onClick={() => setOutputVolume(1)}
                className="text-mint hover:underline"
              >
                {t("settings.audio.restoreOutput")}
              </button>
            </div>
          )}
        </SettingRow>
      </Section>

      <Section title={t("settings.audio.experience")}>
        <SettingRow
          label={t("settings.audio.lowLatency")}
          help={t("settings.audio.lowLatencyHelp")}
        >
          <div className="flex items-center justify-end gap-2">
            <span className="text-[11px] text-fg-muted">
              {lowLatencyBuffer ? t("settings.voice.stateOn") : t("settings.voice.stateOff")}
            </span>
            <Switch
              checked={lowLatencyBuffer}
              onCheckedChange={setLowLatencyBuffer}
              aria-label={t("settings.audio.lowLatency")}
            />
          </div>
        </SettingRow>
      </Section>
    </div>
  );
}

function VoiceTab({ level }: { level: number }) {
  const { t } = useTranslation();
  const {
    pttMode,
    vadThreshold,
    vadThresholdEffective,
    continuousTransmit,
    setPttMode,
    setVadThreshold,
    setContinuousTransmit,
  } = useAppStore();

  const manual = vadThreshold > 0;
  const thresholdDb = clampThresholdDb(
    rmsToDb(manual ? vadThreshold : vadThresholdEffective),
  );
  const thresholdLabel = manual
    ? t("settings.voice.manualThreshold", { value: roundDb(thresholdDb) })
    : t("settings.voice.autoThreshold", { value: roundDb(thresholdDb) });
  const controlsDisabled = continuousTransmit || pttMode === "ptt";

  const setTrigger = (mode: "auto" | "manual") => {
    if (mode === "auto") {
      setVadThreshold(0);
    } else if (!manual) {
      setVadThreshold(dbToRms(DEFAULT_MANUAL_THRESHOLD_DB));
    }
  };

  return (
    <div>
      {/* 发言方式：无说明文字，标签与分段控件同排、垂直居中 */}
      <div className="border-b border-line py-4">
        <InlineRow label={t("settings.voice.mode")}>
          <Segmented
            label={t("settings.voice.mode")}
            value={pttMode}
            onChange={setPttMode}
            options={[
              { value: "open", label: t("settings.voice.free"), icon: <Radio className="size-3.5" /> },
              { value: "ptt", label: t("settings.voice.ptt"), icon: <Mic className="size-3.5" /> },
            ]}
          />
        </InlineRow>
      </div>

      {/* 触发方式：无说明文字，和模式行共用同一种排版 */}
      <div className="border-b border-line py-4">
        <InlineRow label={t("settings.voice.trigger")}>
          <Segmented
            label={t("settings.voice.trigger")}
            value={manual ? "manual" : "auto"}
            disabled={controlsDisabled}
            onChange={setTrigger}
            options={[
              { value: "auto", label: t("settings.voice.auto") },
              { value: "manual", label: t("settings.voice.manual") },
            ]}
          />
        </InlineRow>
      </div>

      {/* 阈值：dB 标尺；标签在上、数值在右，控制区占满整行 */}
      <div className="border-b border-line py-4">
        <div className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-medium leading-tight text-fg">
            {t("settings.voice.threshold")}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {manual && (
              <button
                type="button"
                onClick={() => setVadThreshold(0)}
                className="text-[10.5px] text-mint hover:underline"
              >
                {t("settings.voice.backToAuto")}
              </button>
            )}
            <span className="font-mono text-[11px] text-fg-muted">{thresholdLabel}</span>
          </div>
        </div>

        <div className="mt-2">
          <LevelMeter level={level} thresholdDb={thresholdDb} />
        </div>

        <div className="mt-2">
          <Slider
            value={[roundDb(thresholdDb)]}
            min={THRESHOLD_MIN_DB}
            max={THRESHOLD_MAX_DB}
            step={1}
            disabled={controlsDisabled}
            // 自动模式被拖动时，先固定为当前自动阈值，再按拖动值进入手动。
            onPointerDown={() => {
              if (!manual) setVadThreshold(dbToRms(thresholdDb));
            }}
            onValueChange={([db]) => {
              setVadThreshold(dbToRms(clampThresholdDb(db)));
            }}
          />
        </div>

        <div className="mt-1 flex justify-between font-mono text-[9px] text-fg-subtle">
          <span>-60 dB</span>
          <span>-30</span>
          <span>-6 dB</span>
        </div>
      </div>

      <Section title={t("settings.voice.advanced")}>
        <SettingRow
          label={t("settings.voice.continuous")}
          help={t("settings.voice.continuousHelp")}
        >
          <div className="flex items-center justify-end gap-2">
            <span className="text-[11px] text-fg-muted">
              {continuousTransmit ? t("settings.voice.stateOn") : t("settings.voice.stateOff")}
            </span>
            <Switch
              checked={continuousTransmit}
              onCheckedChange={setContinuousTransmit}
              disabled={pttMode === "ptt"}
              aria-label={t("settings.voice.continuous")}
            />
          </div>
          {pttMode === "ptt" && (
            <p className="mt-1 text-right text-[10.5px] text-fg-subtle">
              {t("settings.voice.continuousPttHint")}
            </p>
          )}
          {continuousTransmit && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.08] px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-soft">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" />
              <span>{t("settings.voice.continuousWarning")}</span>
            </div>
          )}
        </SettingRow>
      </Section>
    </div>
  );
}

function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const current: Locale = i18n.language === "zh-CN" ? "zh-CN" : "en-US";

  return (
    <div>
      <Section title={t("settings.appearance.languageSection")}>
        <SettingRow
          label={t("settings.appearance.language")}
          help={t("settings.appearance.languageHelp")}
        >
          <Select
            value={current}
            onValueChange={(value) => void setLocale(value as Locale)}
          >
            <SelectTrigger
              data-testid="settings-language"
              aria-label={t("settings.appearance.language")}
              className="w-full border-line-control bg-ink-800 text-fg"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-line-control bg-ink-900 text-fg">
              <SelectItem value="zh-CN">
                {t("settings.appearance.languageZh")}
              </SelectItem>
              <SelectItem value="en-US">
                {t("settings.appearance.languageEn")}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>
    </div>
  );
}

function DiagnosticsTab() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<RtcStatsSnapshot>(getLatestStats);
  const [session, setSession] = useState(getSession);
  const [copied, setCopied] = useState(false);
  const reconnectCount = useAppStore((s) => s.reconnectCount);

  const fmtMs = (value: number | null) =>
    value == null
      ? t("settings.diagnostics.unavailable")
      : t("units.ms", { value: Math.round(value) });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats(getLatestStats());
      setSession(getSession());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    [t("settings.diagnostics.rtt"), fmtMs(stats.rttMs)],
    [t("settings.diagnostics.jitter"), fmtMs(stats.jitterBufferDelayMs)],
    [t("settings.diagnostics.target"), fmtMs(stats.jitterBufferTargetMs)],
    [t("settings.diagnostics.minimum"), fmtMs(stats.jitterBufferMinimumMs)],
    [
      t("settings.diagnostics.loss"),
      stats.lossPct == null
        ? t("settings.diagnostics.unavailable")
        : `${stats.lossPct.toFixed(1)}%`,
    ],
    [t("settings.diagnostics.rtcState"), stats.connectionState],
    [t("settings.diagnostics.iceState"), stats.iceConnectionState],
    [t("settings.diagnostics.reconnects"), String(reconnectCount)],
    [
      t("settings.diagnostics.sessionId"),
      session.sid || t("settings.diagnostics.unavailable"),
    ],
    [
      t("settings.diagnostics.version"),
      session.version || t("settings.diagnostics.unavailable"),
    ],
  ];

  return (
    <div>
      <div className="mb-3 flex items-start gap-2">
        <Activity className="mt-0.5 size-4 shrink-0 text-mint" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">
            {t("settings.diagnostics.title")}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            {t("settings.diagnostics.help")}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-ink-950 px-3 py-2">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-4 py-1">
            <span className="text-[11px] text-fg-subtle">{key}</span>
            <span className="truncate font-mono text-[11px] text-fg">{value}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void copyDiag()}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-mint/30 bg-mint/10 text-xs font-medium text-mint hover:bg-mint/15"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copy")}
      </button>
    </div>
  );
}

function AboutTab({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { disconnect } = useAppStore();
  const [version, setVersion] = useState(() => getSession().version);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (version) return;
    let cancelled = false;
    fetch(apiUrl("/api/version"))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.version) setVersion(String(data.version));
      })
      .catch(() => {
        /* 接口不可用时显示未知 */
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <div>
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-mint" />
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("settings.tabs.about")}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
            {t("settings.about.note")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-b border-line py-3 text-xs">
        <span className="text-fg-subtle">{t("settings.about.version")}</span>
        <span className="font-mono text-[11px] text-fg-muted">
          {version || t("settings.about.unknown")}
        </span>
      </div>

      <div className="mt-5">
        {confirming ? (
          <div className="rounded-lg border border-danger/30 bg-danger/[0.06] p-3">
            <p className="text-xs text-danger-soft">{t("settings.about.logoutConfirm")}</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-8 rounded-md border border-line-strong px-3 text-xs text-fg-muted hover:bg-fg/[0.04]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  disconnect();
                }}
                className="h-8 rounded-md bg-danger px-3 text-xs font-medium text-danger-on"
              >
                {t("settings.about.logout")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] text-xs text-danger-soft hover:bg-danger/[0.1]"
          >
            <LogOut className="size-4" />
            {t("settings.about.logout")}
          </button>
        )}
      </div>
    </div>
  );
}

export type SettingsTab =
  | "audio"
  | "voice"
  | "appearance"
  | "diagnostics"
  | "about";
type Tab = SettingsTab;

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
    setInputDevice,
    setOutputDevice,
    setVadThreshold,
    setContinuousTransmit,
    setPttMode,
    setLowLatencyBuffer,
  } = useAppStore();
  const { inputs, outputs, permissionNeeded, requestPermission } = useAudioDevices(open);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [level, setLevel] = useState(0);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setLevel(client.getMicLevel()), 100);
    return () => window.clearInterval(timer);
  }, [open, client]);

  const reset = () => {
    setInputDevice("");
    setOutputDevice("");
    setVadThreshold(0);
    setContinuousTransmit(false);
    setLowLatencyBuffer(true);
    setPttMode("open");
    setResetDone(true);
    window.setTimeout(() => setResetDone(false), 2000);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "audio", label: t("settings.tabs.audio"), icon: <Mic className="size-4" /> },
    { id: "voice", label: t("settings.tabs.voice"), icon: <Radio className="size-4" /> },
    {
      id: "appearance",
      label: t("settings.tabs.appearance"),
      icon: <Languages className="size-4" />,
    },
    { id: "diagnostics", label: t("settings.tabs.diagnostics"), icon: <Activity className="size-4" /> },
    { id: "about", label: t("settings.tabs.about"), icon: <Info className="size-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog grid max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl border-line-control bg-ink-900 p-0 text-fg sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-line px-6 py-4 text-left">
          <DialogTitle className="text-lg font-semibold text-fg">
            {t("settings.title")}
          </DialogTitle>
          <DialogDescription className="text-[11.5px] text-fg-subtle">
            {t("settings.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[200px_minmax(0,1fr)] md:grid-rows-1">
          <nav
            role="tablist"
            aria-label={t("settings.title")}
            aria-orientation="vertical"
            className="flex gap-1 overflow-x-auto border-b border-line p-2 md:flex-col md:border-b-0 md:border-r md:p-3"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                data-testid={`settings-tab-${item.id}`}
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-xs transition-colors ${
                  tab === item.id
                    ? "bg-mint/10 text-fg shadow-rail"
                    : "text-fg-subtle hover:bg-fg/[0.04] hover:text-fg-muted"
                }`}
              >
                <span className={tab === item.id ? "text-mint" : "text-fg-subtle"}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <div
            role="tabpanel"
            className="min-h-0 overflow-y-auto overscroll-contain px-5 py-3 md:px-6"
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
            {tab === "appearance" && <AppearanceTab />}
            {tab === "diagnostics" && <DiagnosticsTab />}
            {tab === "about" && <AboutTab onClose={() => onOpenChange(false)} />}
          </div>
        </div>

        <DialogFooter className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="settings-reset"
              onClick={reset}
              className="h-8 rounded-md border border-line-strong px-3 text-[11.5px] text-fg-muted hover:bg-fg/[0.04] hover:text-fg"
            >
              {t("settings.reset")}
            </button>
            <span className="hidden text-[10.5px] text-fg-subtle sm:inline">
              {resetDone ? t("settings.resetDone") : t("settings.autoSaved")}
            </span>
          </div>
          <button
            type="button"
            data-testid="settings-done"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md bg-mint px-4 text-[11.5px] font-semibold text-on-mint hover:bg-mint-strong"
          >
            {t("settings.done")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
