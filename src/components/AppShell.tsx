import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { useAppStore } from "@/store/appStore";
import { useUiStore } from "@/store/uiStore";
import { useUnreadChannels } from "@/hooks/useUnreadChannels";
import { useEdgeSwipe } from "@/hooks/useEdgeSwipe";
import { TopBar } from "@/components/TopBar";
import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatArea } from "@/components/ChatArea";
import { MemberList } from "@/components/MemberList";
import { VoiceDock } from "@/components/VoiceDock";
import { VoicePanel } from "@/components/VoicePanel";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { ShortcutHelpDialog } from "@/components/ShortcutHelpDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { RemoteAudio } from "@/components/RemoteAudio";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const COLLAPSED_CHANNELS_KEY = "mumble-web.collapsedChannels";

function loadCollapsedChannels(): Set<number> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(COLLAPSED_CHANNELS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => Number.isInteger(id)));
  } catch {
    return new Set();
  }
}

function saveCollapsedChannels(channelIds: Set<number>) {
  try {
    localStorage.setItem(
      COLLAPSED_CHANNELS_KEY,
      JSON.stringify([...channelIds]),
    );
  } catch {
    /* 隐私模式下静默失败 */
  }
}

// 登录就绪后的主界面：桌面为「顶栏 + 左栏（频道 + 语音卡）+ 聊天 + 成员」，
// 移动端隐藏左右栏，保留一行底部语音坞；完整移动端交互在批次 3 细化。
export function AppShell() {
  const { t } = useTranslation();
  const {
    channels,
    connState,
    reconnectAttempt,
    selectedChannelId,
    self,
    joinChannel,
  } = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("audio");
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [memberSearchSignal, setMemberSearchSignal] = useState(0);
  // 单击频道只切换查看的聊天，不改变自己所在的语音频道。
  // 该状态是纯展示层，放在 uiStore，避免影响重连/发言目标。
  const viewChannelId = useUiStore((s) => s.viewChannelId);
  const setViewChannelId = useUiStore((s) => s.setViewChannelId);
  const [collapsedChannels, setCollapsedChannels] =
    useState<Set<number>>(loadCollapsedChannels);
  const unread = useUnreadChannels(viewChannelId);
  const unreadChannels = unread.channels;
  const setUnreadCount = useUiStore((s) => s.setUnreadCount);

  useEffect(() => {
    setUnreadCount(unread.count);
  }, [setUnreadCount, unread.count]);

  useEffect(
    () => () => {
      setUnreadCount(0);
    },
    [setUnreadCount],
  );

  useEffect(() => {
    // 初始进入或切换自身语音频道时，跟随到当前频道。
    setViewChannelId(selectedChannelId ?? self?.channelId ?? 0);
  }, [selectedChannelId, self?.channelId, setViewChannelId]);

  useEffect(() => {
    if (
      Object.keys(channels).length > 0 &&
      !channels[viewChannelId] &&
      self?.channelId != null
    ) {
      setViewChannelId(self.channelId);
    }
  }, [channels, self?.channelId, setViewChannelId, viewChannelId]);

  const toggleCollapse = (channelId: number) => {
    setCollapsedChannels((previous) => {
      const next = new Set(previous);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      saveCollapsedChannels(next);
      return next;
    });
  };

  const openSettings = (tab: SettingsTab = "audio") => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) settingsReturnFocus.current = active;
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (open) return;
    const target = settingsReturnFocus.current;
    // 等 Radix 卸载完再归还焦点，避免焦点落到 body。
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
    }, 0);
  };

  const joinSelected = () => {
    const channelId = selectedChannelId || self?.channelId;
    if (channelId) joinChannel(channelId);
    setChannelsOpen(false);
  };

  const openChannels = useCallback(() => {
    setMembersOpen(false);
    setChannelsOpen(true);
  }, []);

  const openMembers = useCallback(() => {
    setChannelsOpen(false);
    setMembersOpen(true);
  }, []);

  const openShortcutHelp = useCallback(() => setShortcutsOpen(true), []);

  const focusMemberSearch = useCallback(() => {
    // 宽屏成员栏常驻；窄屏先打开成员抽屉，再让 MemberList 聚焦搜索框。
    if (!window.matchMedia("(min-width: 1180px)").matches) openMembers();
    setMemberSearchSignal((value) => value + 1);
  }, [openMembers]);

  useKeyboardShortcuts({
    onHelp: openShortcutHelp,
    onSearchMembers: focusMemberSearch,
  });

  const edgeSwipe = useEdgeSwipe({
    onOpenChannels: openChannels,
    onOpenMembers: openMembers,
    disabled: channelsOpen || membersOpen || settingsOpen || shortcutsOpen,
  });

  return (
    <div
      data-testid="app-shell"
      {...edgeSwipe}
      className="app-shell relative grid w-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-ink-950 text-fg"
    >
      <div className="relative z-20 flex flex-col">
        <TopBar onOpenChannels={openChannels} />
        {connState === "reconnecting" && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
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
            <ChannelSidebar
              viewChannelId={viewChannelId}
              unreadChannels={unreadChannels}
              collapsedChannels={collapsedChannels}
              onToggleCollapse={toggleCollapse}
            />
          </div>
          <VoicePanel
            onOpenSettings={() => openSettings("audio")}
            onOpenVoiceSettings={() => openSettings("voice")}
          />
        </div>
        <ChatArea channelId={viewChannelId} onOpenMembers={openMembers} />
        <MemberList focusSearchSignal={memberSearchSignal} />
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
            <ChannelSidebar
              onNavigate={() => setChannelsOpen(false)}
              viewChannelId={viewChannelId}
              unreadChannels={unreadChannels}
              collapsedChannels={collapsedChannels}
              onToggleCollapse={toggleCollapse}
              instanceId="drawer"
              testId="channel-sidebar-drawer"
            />
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

      <Sheet open={membersOpen} onOpenChange={setMembersOpen}>
        <SheetContent
          side="right"
          className="w-[300px] max-w-[85vw] gap-0 border-line-strong bg-ink-900 p-0"
        >
          <SheetHeader className="border-b border-line px-4 py-3 pr-12">
            <SheetTitle className="text-ui font-semibold text-fg">
              {t("member.title")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("member.description")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <MemberList variant="drawer" focusSearchSignal={memberSearchSignal} />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog
        key={settingsOpen ? `settings-${settingsTab}` : "settings-closed"}
        open={settingsOpen}
        onOpenChange={handleSettingsOpenChange}
        initialTab={settingsTab}
      />
      <ShortcutHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <RemoteAudio />
    </div>
  );
}
