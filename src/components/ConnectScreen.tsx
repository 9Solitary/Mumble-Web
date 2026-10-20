import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ChevronDown, Link2, Loader2 } from "lucide-react";

import { loadIdentity, useAppStore } from "@/store/appStore";
import { clientErrorKey, knownErrorKey } from "@/lib/errorMessages";
import { apiUrl } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { ConnectShell } from "@/components/ConnectShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "host:port" 拆分；无端口或非数字端口时整体作为 host
function splitHostPort(addr: string): { host: string; port: string } {
  const i = addr.lastIndexOf(":");
  if (i > 0 && /^\d+$/.test(addr.slice(i + 1))) {
    return { host: addr.slice(0, i), port: addr.slice(i + 1) };
  }
  return { host: addr, port: "" };
}

export function ConnectScreen({ inviteToken }: { inviteToken?: string }) {
  const { t } = useTranslation();
  const { connState, error, endCode, connect } = useAppStore();
  const inviteMode = inviteToken != null;
  const [identity] = useState(loadIdentity);
  const [username, setUsername] = useState(identity.username ?? "");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState(() => splitHostPort(identity.serverAddr ?? "").host);
  const [port, setPort] = useState(() => splitHostPort(identity.serverAddr ?? "").port);
  const [defaultAddr, setDefaultAddr] = useState(""); // 代理默认上游（占位提示用）
  const [serverOpen, setServerOpen] = useState(!identity.serverAddr);
  const connecting = connState === "connecting" || connState === "connected";
  const knownKey = knownErrorKey(endCode);
  // 客户端自己生成的错误（代理断开、缺少凭据等）是中文原始串，展示层映射；
  // 服务端 code 已知时优先用 code，原始 reason 只进“详情”。
  const clientKey = knownKey ? null : clientErrorKey(error);
  const localizedError = knownKey ?? clientKey ?? (error ? "errors.generic" : null);
  const showDetail =
    !!error &&
    !!localizedError &&
    !clientKey &&
    error !== t(localizedError);

  // 无本地记忆时，用代理当前配置预填服务器地址（邀请模式不展示服务器，无需预填）
  useEffect(() => {
    if (inviteMode || identity.serverAddr) return;
    let cancelled = false;
    fetch(apiUrl("/api/server"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const addr: string = d.resolved || d.address || "";
        setDefaultAddr(addr);
        if (addr) {
          const p = splitHostPort(addr);
          setHost(p.host);
          setPort(p.port);
          // 代理已经给出默认服务器时，折叠服务器字段，短屏也能一屏放下。
          setServerOpen(false);
        }
      })
      .catch(() => {
        /* 接口不可用时留空，连接时使用代理默认 */
      });
    return () => {
      cancelled = true;
    };
  }, [identity.serverAddr, inviteMode]);

  const portTrim = port.trim();
  const portInvalid =
    portTrim !== "" &&
    (!/^\d+$/.test(portTrim) || Number(portTrim) < 1 || Number(portTrim) > 65535);
  const hostTrim = host.trim();
  const serverAddr = hostTrim
    ? portTrim
      ? `${hostTrim}:${portTrim}`
      : hostTrim
    : "";

  return (
    <ConnectShell cardTestId="connect-card">
      <div className="mb-5">
        <h1 className="text-title font-semibold tracking-tight text-fg">
          {inviteMode ? t("connect.inviteTitle") : t("connect.title")}
        </h1>
        <p className="mt-1.5 text-caption text-fg-muted">
          {inviteMode ? t("connect.inviteDescription") : t("connect.description")}
        </p>
      </div>

      {inviteMode && (
        <div className="mb-4 flex items-start gap-2 rounded-control border border-line bg-ink-850 px-3 py-2 text-caption text-fg-muted">
          <Link2 className="mt-0.5 size-3.5 shrink-0 text-mint" />
          <span>{t("connect.inviteNotice")}</span>
        </div>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!username.trim() || (!inviteMode && portInvalid)) return;
          if (inviteMode) connect(username.trim(), "", "", inviteToken);
          else connect(username.trim(), password, serverAddr);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="username">
            {t("connect.username")}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="username"
            data-testid="connect-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("connect.usernamePlaceholder")}
            autoFocus
            required
            autoComplete="username"
            aria-describedby="username-hint"
          />
          <p id="username-hint" className="text-data text-fg-subtle">
            {t("connect.usernameHint")}
          </p>
        </div>

        {!inviteMode && (
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("connect.passwordOptional")}</Label>
            <Input
              id="password"
              data-testid="connect-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("connect.passwordPlaceholder")}
              autoComplete="off"
            />
          </div>
        )}

        {!inviteMode && (
          <details
            className="group rounded-control border border-line bg-ink-850/60 px-3 py-2"
            open={serverOpen}
            onToggle={(e) => setServerOpen(e.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-2 text-ui text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <span>{t("connect.serverAdvanced")}</span>
              <ChevronDown className="size-4 shrink-0 transition-transform duration-fast group-open:rotate-180" />
            </summary>
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="server">{t("connect.serverAddress")}</Label>
                <Input
                  id="server"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={
                    defaultAddr
                      ? splitHostPort(defaultAddr).host
                      : t("connect.serverPlaceholder")
                  }
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port">{t("connect.serverPort")}</Label>
                <Input
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="64738"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={portInvalid}
                  aria-describedby="port-help"
                  className="w-28"
                />
              </div>
              <p
                id="port-help"
                className={portInvalid ? "text-data text-danger" : "text-data text-fg-subtle"}
              >
                {portInvalid ? t("connect.portInvalid") : t("connect.serverHelp")}
              </p>
            </div>
          </details>
        )}

        {error && localizedError && (
          <div
            role="alert"
            data-testid="connect-error"
            className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2.5 text-caption text-danger"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0">{t(localizedError)}</p>
            </div>
            {showDetail && (
              <details className="mt-1.5 pl-6 text-data text-danger-muted">
                <summary className="cursor-pointer select-none">
                  {t("common.details")}
                </summary>
                <p className="mt-1 break-words font-mono leading-relaxed">{error}</p>
              </details>
            )}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          data-testid="connect-submit"
          disabled={!username.trim() || connecting || portInvalid}
          className="w-full"
        >
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("connect.connecting")}
            </>
          ) : (
            t("connect.submit")
          )}
        </Button>
      </form>
    </ConnectShell>
  );
}
