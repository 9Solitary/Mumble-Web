import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { AlertTriangle, Loader2 } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { ConnectScreen } from "@/components/ConnectScreen";
import { ConnectShell } from "@/components/ConnectShell";
import { MainLayout } from "@/components/MainLayout";
import { SessionEnded } from "@/components/SessionEnded";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/backend";

function InviteStatus({ message }: { message: string }) {
  return (
    <ConnectShell cardTestId="invite-status">
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 className="size-7 animate-spin text-mint" />
        <p className="text-ui text-fg-muted">{message}</p>
      </div>
    </ConnectShell>
  );
}

// 一次性邀请链接入口：校验 token -> 仅需用户名的连接表单 -> 主界面。
// token 的服务器/密码保存在代理服务端，本页面拿不到也不需要。
export function InvitePage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const connState = useAppStore((s) => s.connState);
  const inviteToken = useAppStore((s) => s.inviteToken);
  const [check, setCheck] = useState<"checking" | "valid" | "invalid">("checking");
  const [reason, setReason] = useState("");
  const [proxyFailed, setProxyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/invites/${encodeURIComponent(token)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.valid) {
          setCheck("valid");
        } else {
          setCheck("invalid");
          setReason(d?.reason || "");
          setProxyFailed(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCheck("invalid");
        setReason("");
        setProxyFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 会话被顶/被踢：与普通流程一样停在终止页，不回到邀请表单
  if (connState === "ended") return <SessionEnded />;

  // 本标签页已发起邀请连接：跟随连接状态渲染（被拒时回到表单并展示错误）
  if (inviteToken === token && connState !== "idle") {
    if (connState === "ready") return <MainLayout />;
    if (connState === "connected") return <InviteStatus message={t("app.loading")} />;
    return <ConnectScreen inviteToken={token} />;
  }

  if (check === "checking") {
    return <InviteStatus message={t("connect.checkingInvite")} />;
  }

  if (check === "invalid") {
    return (
      <ConnectShell cardTestId="invite-invalid-card">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-panel border border-danger/25 bg-danger/10">
            <AlertTriangle className="size-6 text-danger" />
          </div>
          <h1 className="text-title font-semibold tracking-tight text-fg">
            {t("connect.invalidInviteTitle")}
          </h1>
          <p className="mt-2 max-w-[34ch] text-caption text-fg-subtle">
            {proxyFailed
              ? t("connect.proxyUnavailable")
              : t("connect.invalidInviteBody")}
          </p>
          {reason && (
            <details className="mt-3 w-full rounded-lg border border-line bg-ink-950 px-3 py-2 text-left">
              <summary className="cursor-pointer text-[11px] text-fg-subtle">
                {t("common.details")}
              </summary>
              <p className="mt-1 break-words font-mono text-[10.5px] text-fg-muted">
                {reason}
              </p>
            </details>
          )}
          <Link
            to="/"
            className={cn(buttonVariants({ variant: "outline" }), "mt-5 w-full")}
          >
            {t("connect.backToConnect")}
          </Link>
        </div>
      </ConnectShell>
    );
  }

  return <ConnectScreen inviteToken={token} />;
}
