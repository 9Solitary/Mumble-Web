import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Check, Copy, Download } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import {
  exportJSON,
  getEvents,
  getSession,
  type DiagEvent,
} from "@/lib/diagnostics";
import { getLatestStats, type RtcStatsSnapshot } from "@/lib/rtcStats";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/lib/toast";

function eventDetail(event: DiagEvent): string {
  const parts = Object.entries(event.data).map(([key, value]) => {
    const text = typeof value === "string" ? value : String(value);
    return `${key}=${text.length > 90 ? `${text.slice(0, 90)}…` : text}`;
  });
  return parts.join(" · ") || "—";
}

function eventTime(ts: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ts * 1000));
  } catch {
    return new Date(ts * 1000).toLocaleTimeString();
  }
}

export function DiagnosticsTab() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<RtcStatsSnapshot>(getLatestStats);
  const [session, setSession] = useState(getSession);
  const [events, setEvents] = useState<DiagEvent[]>(getEvents);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const reconnectCount = useAppStore((s) => s.reconnectCount);

  const fmtMs = (value: number | null) =>
    value == null
      ? t("settings.diagnostics.unavailable")
      : t("units.ms", { value: Math.round(value) });

  useEffect(() => {
    const refresh = () => {
      setStats(getLatestStats());
      setSession(getSession());
      setEvents(getEvents());
    };
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const copyDiag = async () => {
    try {
      await navigator.clipboard.writeText(exportJSON());
      setCopied(true);
      toastSuccess(t("settings.diagnostics.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toastError(t("settings.diagnostics.copyFailed"));
    }
  };

  const exportDiag = () => {
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const blob = new Blob([exportJSON()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mumble-diagnostics-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExported(true);
      toastSuccess(t("settings.diagnostics.exported"));
      window.setTimeout(() => setExported(false), 2000);
    } catch {
      toastError(t("settings.diagnostics.exportFailed"));
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

  // 最新事件在上；最多 500 条由 diagnostics.ts 的环形缓冲保证。
  const newestFirst = useMemo(() => [...events].reverse(), [events]);

  return (
    <div data-testid="settings-panel-diagnostics">
      <div className="mb-3 flex items-start gap-2">
        <Activity className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden="true" />
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

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="diagnostics-copy"
          onClick={() => void copyDiag()}
          className="border-mint/30 bg-mint/10 text-mint hover:border-mint/45 hover:bg-mint/15"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="diagnostics-export"
          onClick={exportDiag}
        >
          {exported ? <Check className="size-4" /> : <Download className="size-4" />}
          {exported ? t("settings.diagnostics.exported") : t("settings.diagnostics.export")}
        </Button>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t("settings.diagnostics.logTitle")}
          </h4>
          <span className="font-mono text-data text-fg-subtle">
            {t("settings.diagnostics.logCount", { count: events.length })}
          </span>
        </div>
        <p className="mt-1 max-w-[60ch] text-[10.5px] leading-relaxed text-fg-subtle">
          {t("settings.diagnostics.logHelp")}
        </p>
        <div
          data-testid="diagnostics-log"
          role="region"
          aria-label={t("settings.diagnostics.logTitle")}
          tabIndex={0}
          className="mt-2 max-h-[min(280px,30dvh)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-ink-950 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-mint/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
        >
          {newestFirst.length === 0 ? (
            <p className="px-1 py-4 text-center text-[11px] text-fg-subtle" role="status">
              {t("settings.diagnostics.logEmpty")}
            </p>
          ) : (
            newestFirst.map((event, index) => (
              <div
                key={`${event.ts}-${event.kind}-${index}`}
                className="flex items-baseline gap-2 border-b border-line/60 py-1 font-mono text-[10.5px] last:border-b-0"
              >
                <span className="shrink-0 text-fg-subtle">
                  {eventTime(event.ts, i18n.language)}
                </span>
                <span className="shrink-0 text-mint">{event.kind}</span>
                <span className="min-w-0 flex-1 truncate text-fg-muted" title={eventDetail(event)}>
                  {eventDetail(event)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
