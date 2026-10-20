import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Clock3,
  Copy,
  Info,
  Link2,
  Loader2,
  LogOut,
} from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastError, toastSuccess } from "@/lib/toast";

type InviteErrorKey =
  | "invite.errorUnavailable"
  | "invite.errorForbidden"
  | "invite.errorNotReady"
  | "invite.errorNetwork"
  | "invite.errorGeneric";

const INVITE_ERROR_KEYS: Record<string, InviteErrorKey> = {
  invite_unavailable: "invite.errorUnavailable",
  invite_forbidden: "invite.errorForbidden",
  invite_not_ready: "invite.errorNotReady",
  invite_network: "invite.errorNetwork",
  invite_failed: "invite.errorGeneric",
};

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const {
    inviteStatus,
    inviteLink,
    inviteError,
    createInvite,
  } = useAppStore();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loading = inviteStatus === "loading";
  const ready = inviteStatus === "ready" && inviteLink != null;
  const failed = inviteStatus === "error";
  const errorMessage = t(INVITE_ERROR_KEYS[inviteError] ?? "invite.errorGeneric");
  const minutes = inviteLink?.minutes ?? 0;

  useEffect(() => {
    if (!open) return;
    // 同一个主按钮贯穿所有状态，既保持焦点，也避免出现第二个并列主动作。
    // rAF 等 Radix 的 onOpenAutoFocus 先落定；loading 时按钮 disabled，不强抢焦点。
    const frame = window.requestAnimationFrame(() => {
      if (primaryRef.current && !primaryRef.current.disabled) {
        primaryRef.current.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [failed, loading, open, ready]);

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      toastSuccess(t("invite.copied"));
    } catch {
      // 剪贴板不可用时选中链接，用户仍可手动复制；按钮保留可重试。
      inputRef.current?.select();
      toastError(t("invite.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="invite-dialog"
        tabIndex={-1}
        className="gap-0 p-5 sm:max-w-md sm:p-6"
        onOpenAutoFocus={(event) => {
          // 入口即生成，打开时主按钮通常处于 disabled 的 loading 态。
          // 先聚焦弹窗容器，等链接/错误就绪后再由 effect 把焦点交给主按钮。
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t("invite.title")}</DialogTitle>
          <DialogDescription>{t("invite.description")}</DialogDescription>
        </DialogHeader>

        <div className="mt-5">
          {ready ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="invite-link">{t("invite.linkLabel")}</Label>
                <Input
                  id="invite-link"
                  ref={inputRef}
                  data-testid="invite-url"
                  value={inviteLink.url}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-10 font-mono text-ui md:h-10"
                  aria-describedby="invite-expiry invite-claim-note"
                />
              </div>
              <div className="space-y-1 text-caption text-fg-subtle">
                <p id="invite-expiry" className="flex items-center gap-1.5">
                  <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                  {t("invite.expiry", { minutes })}
                </p>
                <p id="invite-claim-note" className="flex items-center gap-1.5">
                  <LogOut className="size-3.5 shrink-0" aria-hidden="true" />
                  {t("invite.claimNote")}
                </p>
              </div>
            </div>
          ) : failed ? (
            <div
              role="alert"
              data-testid="invite-error"
              className="flex items-start gap-2.5 rounded-control border border-danger/30 bg-danger/10 px-3 py-3 text-caption text-danger-soft"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="min-w-0">{errorMessage}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-control border border-line bg-ink-850/60 px-3 py-3 text-caption text-fg-muted">
              <Info className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden="true" />
              <p className="min-w-0">{t("invite.initialNote")}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-5">
          <Button
            ref={primaryRef}
            type="button"
            size="lg"
            data-testid={
              ready
                ? "invite-copy"
                : failed
                  ? "invite-retry"
                  : "invite-generate"
            }
            className="h-11 w-full gap-2 md:h-10"
            disabled={loading}
            aria-busy={loading}
            onClick={() => {
              if (ready) void copyLink();
              else createInvite();
            }}
          >
            {ready ? (
              <Copy className="size-4" aria-hidden="true" />
            ) : loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="size-4" aria-hidden="true" />
            )}
            {ready
              ? t("invite.copy")
              : loading
                ? t("invite.generating")
                : failed
                  ? t("common.retry")
                  : t("invite.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
