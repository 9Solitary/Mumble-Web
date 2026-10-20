import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { sessionCopy } from "@/lib/errorMessages";
import { AlertCircle, ArrowLeft, RotateCcw } from "lucide-react";

export function SessionEnded() {
  const { t } = useTranslation();
  const { endCode, endDetail, retryAfterEnd, returnToConnect, self, server } =
    useAppStore();
  const copy = sessionCopy(endCode || "session_takeover");
  // 被封禁、或昵称被服务器以外的客户端占用时，重试没有意义；引导换昵称。
  const canRetry = endCode !== "banned" && endCode !== "username_in_use";
  const showRetryHint = endCode === "session_takeover";

  return (
    <main
      aria-labelledby="session-ended-title"
      data-testid="session-ended"
      className="flex min-h-screen w-full items-center justify-center bg-ink-950 p-6"
    >
      <div className="w-full max-w-[440px] rounded-2xl border border-line-strong bg-ink-900 p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-amber/30 bg-amber/10">
          <AlertCircle className="h-5 w-5 text-amber" aria-hidden="true" />
        </div>

        <h1
          id="session-ended-title"
          className="text-xl font-semibold tracking-tight text-fg"
        >
          {t(copy.title)}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{t(copy.body)}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-subtle">
          {t("session.noAutoReconnect")}
        </p>

        {(self?.name || server?.address) && (
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px]">
            {self?.name && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-fg-subtle">{t("session.name")}</span>
                <span className="min-w-0 truncate text-fg-muted">{self.name}</span>
              </div>
            )}
            {server?.address && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-fg-subtle">
                  {t("settings.about.server")}
                </span>
                <span className="min-w-0 truncate font-mono text-fg-muted">
                  {server.address}
                </span>
              </div>
            )}
          </div>
        )}

        {endDetail && (
          <details className="mt-4 rounded-lg border border-line bg-ink-950 px-3 py-2">
            <summary className="cursor-pointer text-[11px] text-fg-subtle">
              {t("session.detail")}
            </summary>
            <p className="mt-1 break-words font-mono text-[10.5px] text-fg-muted">
              {endDetail}
            </p>
          </details>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {canRetry && (
            <button
              type="button"
              data-testid="session-retry"
              onClick={retryAfterEnd}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-mint text-sm font-semibold text-on-mint transition-colors hover:bg-mint-strong sm:h-10"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("session.retry")}
            </button>
          )}
          <button
            type="button"
            data-testid="session-change-name"
            onClick={returnToConnect}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-control border border-line-strong text-sm text-fg-muted transition-colors hover:bg-fg/[0.04] hover:text-fg sm:h-10"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("session.changeName")}
          </button>
        </div>

        {showRetryHint && (
          <p className="mt-3 text-center text-[10.5px] text-fg-subtle">
            {t("session.retryHint")}
          </p>
        )}
      </div>
    </main>
  );
}
