import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { roundDb, rmsToDb } from "@/lib/audioLevel";
import { DEFAULT_DEVICE, deviceLabel } from "@/components/settings/devices";
import { LevelMeter, Section, SettingRow } from "@/components/settings/shared";
import { toastSuccess } from "@/lib/toast";

export function AudioTab({
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
    <div data-testid="settings-panel-audio">
      <Section title={t("settings.audio.inputSection")}>
        <SettingRow label={t("settings.audio.input")}>
          <Select
            value={inputDeviceId || DEFAULT_DEVICE}
            onValueChange={(value) => setInputDevice(value === DEFAULT_DEVICE ? "" : value)}
          >
            <SelectTrigger
              aria-label={t("settings.audio.input")}
              className="w-full border-line-control bg-ink-800 text-fg"
            >
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
            <div
              role="status"
              className="mt-2 flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.08] px-2.5 py-2 text-[11px] leading-relaxed text-amber-soft"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden="true" />
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
          <div aria-hidden="true">
            <LevelMeter level={level} />
          </div>
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
            <SelectTrigger
              aria-label={t("settings.audio.output")}
              className="w-full border-line-control bg-ink-800 text-fg"
            >
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

        <SettingRow
          label={t("settings.audio.outputVolume")}
          help={t("settings.audio.outputVolumeHelp")}
          testId="settings-output-volume"
        >
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
                onClick={() => {
                  setOutputVolume(1);
                  toastSuccess(t("settings.audio.outputRestored"));
                }}
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
