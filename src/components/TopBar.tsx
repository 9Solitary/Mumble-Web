import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { useRtt } from "@/hooks/useRtt";
import { AccountMenu } from "@/components/AccountMenu";
import { BrandMark } from "@/components/BrandMark";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function TopBar({ onOpenChannels }: { onOpenChannels: () => void }) {
  const { t } = useTranslation();
  const { server, connState, reconnectAttempt } = useAppStore();
  const rtt = useRtt();
  const reconnecting = connState === "reconnecting";
  const serverLabel = server?.address || t("shell.serverFallback");

  return (
    <header
      data-testid="topbar"
      className="relative z-20 flex h-topbar shrink-0 items-center gap-2 border-b border-line bg-ink-900 px-3 md:gap-3 md:px-4"
    >
      <IconButton
        label={t("shell.channels")}
        onClick={onOpenChannels}
        size="sm"
        className="size-11 md:hidden"
      >
        <Menu className="size-5" />
      </IconButton>

      <div className="flex min-w-0 items-center gap-2">
        <BrandMark />
        <span className="hidden text-ui font-semibold tracking-tight text-fg sm:inline">
          Mumble
        </span>
        <span className="hidden text-data font-semibold tracking-[0.16em] text-fg-subtle lg:inline">
          WEB
        </span>
      </div>

      <span className="hidden h-5 w-px shrink-0 bg-line-strong min-[900px]:block" />

      <div className="hidden min-w-0 flex-1 items-center gap-3 min-[900px]:flex">
        <span className="min-w-0 truncate text-ui text-fg-muted" title={serverLabel}>
          {serverLabel}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="connection-pill"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-data",
            reconnecting
              ? "border-amber/30 bg-amber/10 text-amber"
              : "border-mint/25 bg-mint/10 text-mint",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              reconnecting ? "bg-amber" : "bg-mint",
            )}
          />
          {reconnecting
            ? reconnectAttempt > 0
              ? t("shell.reconnectingAttempt", { attempt: reconnectAttempt })
              : t("shell.reconnecting")
            : t("shell.connected")}
          {!reconnecting && rtt != null && (
            <span className="hidden font-mono text-fg-muted sm:inline">
              {t("units.ms", { value: Math.round(rtt) })}
            </span>
          )}
        </span>
      </div>

      <div className="ml-auto flex min-[900px]:ml-0">
        <AccountMenu />
      </div>
    </header>
  );
}
