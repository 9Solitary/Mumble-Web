import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, LogOut } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { APP_VERSION } from "@/lib/appVersion";
import { apiUrl } from "@/lib/backend";
import { getSession } from "@/lib/diagnostics";

export function AboutTab({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { disconnect, server } = useAppStore();
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
    <div data-testid="settings-panel-about">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("settings.tabs.about")}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
            {t("settings.about.note")}
          </p>
        </div>
      </div>

      <dl className="mt-4 border-t border-line">
        <div className="flex items-center justify-between gap-4 border-b border-line py-3 text-xs">
          <dt className="text-fg-subtle">{t("settings.about.webVersion")}</dt>
          <dd
            data-testid="about-web-version"
            className="min-w-0 truncate font-mono text-[11px] text-fg-muted"
          >
            {APP_VERSION}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line py-3 text-xs">
          <dt className="text-fg-subtle">{t("settings.about.version")}</dt>
          <dd className="min-w-0 truncate font-mono text-[11px] text-fg-muted">
            {version || t("settings.about.unknown")}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line py-3 text-xs">
          <dt className="text-fg-subtle">{t("settings.about.server")}</dt>
          <dd className="min-w-0 truncate font-mono text-[11px] text-fg-muted">
            {server?.address || t("settings.about.unknown")}
          </dd>
        </div>
      </dl>

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
            <LogOut className="size-4" aria-hidden="true" />
            {t("settings.about.logout")}
          </button>
        )}
      </div>
    </div>
  );
}
