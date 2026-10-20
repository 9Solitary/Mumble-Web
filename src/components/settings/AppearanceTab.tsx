import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLocale, type Locale } from "@/i18n";
import { Section, SettingRow } from "@/components/settings/shared";

export function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const current: Locale = i18n.language === "zh-CN" ? "zh-CN" : "en-US";

  return (
    <div data-testid="settings-panel-appearance">
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
