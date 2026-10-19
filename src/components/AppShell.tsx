import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { TopBar } from "@/components/TopBar";
import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatArea } from "@/components/ChatArea";
import { MemberList } from "@/components/MemberList";
import { VoiceDock } from "@/components/VoiceDock";
import { VoicePanel } from "@/components/VoicePanel";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { RemoteAudio } from "@/components/RemoteAudio";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// 登录就绪后的主界面：桌面为「顶栏 + 左栏（频道 + 语音卡）+ 聊天 + 成员」，
// 移动端隐藏左右栏，保留一行底部语音坞；完整移动端交互在批次 3 细化。
export function AppShell() {
  const { t } = useTranslation();
  const { connState, reconnectAttempt, selectedChannelId, self, joinChannel } =
    useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("audio");
  const [channelsOpen, setChannelsOpen] = useState(false);

  const openSettings = (tab: SettingsTab = "audio") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const joinSelected = () => {
    const channelId = selectedChannelId || self?.channelId;
    if (channelId) joinChannel(channelId);
    setChannelsOpen(false);
  };

  return (
    <div
      data-testid="app-shell"
      className="app-shell relative grid w-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-ink-950 text-fg"
    >
      <div className="relative z-20 flex flex-col">
        <TopBar onOpenChannels={() => setChannelsOpen(true)} />
        {connState === "reconnecting" && (
          <div
            role="status"
            aria-live="polite"
            className="flex h-7 shrink-0 items-center justify-center gap-2 border-b border-amber/20 bg-amber-strong px-3 text-data font-semibold text-ink-950"
          >
            <Loader2 className="size-3.5 animate-spin" />
            {reconnectAttempt > 0
              ? t("app.reconnectingAttempt", { attempt: reconnectAttempt })
              : t("app.reconnecting")}
          </div>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] min-[1180px]:grid-cols-[268px_minmax(0,1fr)_252px]">
        <div className="hidden min-h-0 flex-col md:flex">
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChannelSidebar />
          </div>
          <VoicePanel
            onOpenSettings={() => openSettings("audio")}
            onOpenVoiceSettings={() => openSettings("voice")}
          />
        </div>
        <ChatArea />
        <MemberList />
      </div>

      <VoiceDock onOpenSettings={() => openSettings("audio")} />

      <Sheet open={channelsOpen} onOpenChange={setChannelsOpen}>
        <SheetContent
          side="left"
          className="w-[280px] max-w-[85vw] gap-0 border-line-strong bg-ink-900 p-0"
        >
          <SheetHeader className="border-b border-line px-4 py-3 pr-12">
            <SheetTitle className="text-ui font-semibold text-fg">
              {t("shell.channels")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("shell.channelsDescription")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChannelSidebar onNavigate={() => setChannelsOpen(false)} />
          </div>
          <div className="border-t border-line p-3">
            <Button
              className="w-full"
              data-testid="sheet-join-channel"
              onClick={joinSelected}
              disabled={!self}
            >
              {t("shell.joinChannel")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog
        key={settingsOpen ? `settings-${settingsTab}` : "settings-closed"}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
      />
      <RemoteAudio />
    </div>
  );
}
