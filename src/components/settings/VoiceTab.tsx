import { useTranslation } from "react-i18next";
import { AlertTriangle, Mic, Radio } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_MANUAL_THRESHOLD_DB,
  THRESHOLD_MAX_DB,
  THRESHOLD_MIN_DB,
  clampThresholdDb,
  dbToRms,
  rmsToDb,
  roundDb,
} from "@/lib/audioLevel";
import {
  InlineRow,
  LevelMeter,
  Section,
  Segmented,
  SettingRow,
} from "@/components/settings/shared";

export function VoiceTab({ level }: { level: number }) {
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
    <div data-testid="settings-panel-voice">
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

        <div className="mt-2" aria-hidden="true">
          <LevelMeter level={level} thresholdDb={thresholdDb} />
        </div>

        <div className="mt-2">
          <Slider
            aria-label={t("settings.voice.threshold")}
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
            <div
              role="status"
              className="mt-2 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.08] px-2.5 py-2 text-[10.5px] leading-relaxed text-amber-soft"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden="true" />
              <span>{t("settings.voice.continuousWarning")}</span>
            </div>
          )}
        </SettingRow>
      </Section>
    </div>
  );
}
