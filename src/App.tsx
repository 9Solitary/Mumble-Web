import { useEffect } from "react";
import { Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { useUiStore } from "@/store/uiStore";
import { ConnectScreen } from "@/components/ConnectScreen";
import { MainLayout } from "@/components/MainLayout";
import { SessionEnded } from "@/components/SessionEnded";
import { InvitePage } from "@/pages/InvitePage";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

// 页面标题跟随频道/连接状态，标签页能看出当前在哪。
function DocumentMeta() {
  const { t, i18n } = useTranslation();
  const connState = useAppStore((s) => s.connState);
  const viewChannelId = useUiStore((s) => s.viewChannelId);
  const channelName = useAppStore(
    (s) =>
      s.channels[viewChannelId]?.name ??
      s.channels[s.currentChannelId]?.name,
  );
  const unreadCount = useUiStore((s) => s.unreadCount);

  useEffect(() => {
    const base = t("app.title");
    if (connState === "ended") {
      document.title = `${t("app.ended")} · ${base}`;
    } else if (connState === "reconnecting") {
      document.title = `${t("app.reconnectingShort")} · ${base}`;
    } else if (channelName && (connState === "ready" || connState === "connected")) {
      const channelTitle = `${channelName} · ${base}`;
      document.title =
        unreadCount > 0
          ? t("app.titleUnread", {
              count: unreadCount > 99 ? "99+" : String(unreadCount),
              title: channelTitle,
            })
          : channelTitle;
    } else {
      document.title = base;
    }

    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", t("app.description"));
    const ogDescription = document.querySelector(
      'meta[property="og:description"]',
    );
    if (ogDescription) {
      ogDescription.setAttribute("content", t("app.description"));
    }
  }, [channelName, connState, i18n.language, t, unreadCount, viewChannelId]);

  return null;
}

// 普通连接流程：按连接状态在登录页 / 同步中 / 主界面 / 终止页之间切换
function HomeFlow() {
  const { t } = useTranslation();
  const connState = useAppStore((s) => s.connState);

  if (connState === "ended") return <SessionEnded />;

  if (connState === "idle" || connState === "failed" || connState === "connecting") {
    return <ConnectScreen />;
  }

  if (connState === "connected") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink-950 text-fg-muted"
      >
        <Loader2 className="h-8 w-8 animate-spin text-mint" aria-hidden="true" />
        <p className="text-sm">{t("app.loading")}</p>
      </div>
    );
  }

  return <MainLayout />;
}

export default function App() {
  return (
    <>
      <DocumentMeta />
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<HomeFlow />} />
      </Routes>
      <Toaster />
    </>
  );
}
