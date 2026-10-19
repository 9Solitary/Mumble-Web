import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { rmsToDb, roundDb } from "@/lib/audioLevel";
import { micErrorKey } from "@/lib/errorMessages";

// 语音坞/语音卡共用的状态文案，避免两处逻辑漂移。
export function useVoiceStatus(): string {
  const { t } = useTranslation();
  const {
    selfTalking,
    micReady,
    micError,
    selfMuted,
    selfDeafened,
    pttMode,
    vadThreshold,
    continuousTransmit,
  } = useAppStore();

  if (micError) return t(micErrorKey(micError) ?? "errors.micUnknown");
  if (!micReady) return t("userbar.micInitializing");
  if (selfTalking) {
    return continuousTransmit ? t("userbar.continuous") : t("userbar.talking");
  }
  if (selfMuted) return t("userbar.muted");
  if (selfDeafened) return t("userbar.deafened");
  if (pttMode === "ptt") return t("userbar.ptt");
  if (vadThreshold > 0) {
    return t("userbar.threshold", { value: roundDb(rmsToDb(vadThreshold)) });
  }
  return t("userbar.auto");
}

export function useVoiceModeLabel(): string {
  const { t } = useTranslation();
  const { pttMode, vadThreshold, continuousTransmit } = useAppStore();

  if (continuousTransmit) return t("userbar.continuous");
  if (pttMode === "ptt") return t("voicePanel.modePtt");
  if (vadThreshold > 0) {
    return t("voicePanel.modeThreshold", { value: roundDb(rmsToDb(vadThreshold)) });
  }
  return t("voicePanel.modeAuto");
}
