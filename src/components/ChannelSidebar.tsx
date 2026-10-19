import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "./UserAvatar";
import { UserContextMenu } from "./UserContextMenu";
import { Volume2, VolumeX, MicOff, HeadphoneOff, Crown, ChevronRight } from "lucide-react";
import type { ChannelInfo, UserInfo } from "@/lib/protocol";

function VoiceUserRow({ user }: { user: UserInfo }) {
  const talking = useAppStore((s) =>
    s.self?.session === user.session
      ? s.selfTalking
      : !!s.talking[user.session],
  );
  const locallyMuted = useAppStore((s) => !!s.localMuted[user.session]);
  const silenced = user.selfMuted || user.muted || user.suppressed;
  return (
    <UserContextMenu user={user}>
      <div className="flex items-center gap-2 pl-8 pr-3 py-1 rounded-md mx-1 hover:bg-ink-800 cursor-default group">
        <UserAvatar name={user.name} size={24} talking={talking} muted={silenced} />
        <span
          className={`text-sm truncate flex-1 ${
            talking ? "text-fg" : silenced ? "text-fg-subtle" : "text-fg-muted"
          }`}
        >
          {user.name}
        </span>
        {user.prioritySpeaker && <Crown className="w-3.5 h-3.5 text-amber-bright" />}
        {locallyMuted && <VolumeX className="w-3.5 h-3.5 text-danger" />}
        {(user.selfDeafened || user.deafened) && (
          <HeadphoneOff className="w-3.5 h-3.5 text-danger" />
        )}
        {silenced && <MicOff className="w-3.5 h-3.5 text-danger" />}
      </div>
    </UserContextMenu>
  );
}

function ChannelNode({
  channel,
  childrenMap,
  usersByChannel,
  depth,
  onNavigate,
}: {
  channel: ChannelInfo;
  childrenMap: Map<number, ChannelInfo[]>;
  usersByChannel: Map<number, UserInfo[]>;
  depth: number;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const { self, selectedChannelId, selectChannel, joinChannel } = useAppStore();
  const occupants = usersByChannel.get(channel.id) ?? [];
  const isSelfHere = self?.channelId === channel.id;
  const isSelected = selectedChannelId === channel.id;
  const children = childrenMap.get(channel.id) ?? [];

  return (
    <div>
      <button
        onClick={() => {
          selectChannel(channel.id);
        }}
        onDoubleClick={() => {
          joinChannel(channel.id);
          onNavigate?.();
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md text-left group transition-colors select-none ${
          isSelected ? "bg-mint/10 text-fg shadow-rail" : "text-fg-subtle hover:bg-ink-800 hover:text-fg"
        }`}
        style={{ width: "calc(100% - 8px)", paddingLeft: `${8 + depth * 12}px` }}
        title={t("shell.channelTitle", {
          name: channel.description || channel.name,
        })}
        data-testid={`channel-${channel.id}`}
        aria-current={isSelfHere ? "true" : undefined}
      >
        {children.length > 0 ? (
          <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />
        ) : (
          <span className="w-3" />
        )}
        <Volume2 className="w-4 h-4 shrink-0 opacity-70" />
        <span className={`flex-1 truncate text-ui ${isSelfHere ? "font-semibold" : ""}`}>
          {channel.name}
        </span>
        {occupants.length > 0 && (
          <span className="text-data text-fg-subtle">{occupants.length}</span>
        )}
      </button>
      {occupants.map((u) => (
        <VoiceUserRow key={u.session} user={u} />
      ))}
      {children.map((c) => (
        <ChannelNode
          key={c.id}
          channel={c}
          childrenMap={childrenMap}
          usersByChannel={usersByChannel}
          depth={depth + 1}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

export function ChannelSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { channels, users } = useAppStore();

  const { childrenMap, usersByChannel, roots } = useMemo(() => {
    const all = Object.values(channels).sort((a, b) => a.position - b.position || a.id - b.id);
    const childrenMap = new Map<number, ChannelInfo[]>();
    const roots: ChannelInfo[] = [];
    for (const ch of all) {
      if (ch.parentId < 0) {
        roots.push(ch);
      } else {
        const list = childrenMap.get(ch.parentId) ?? [];
        list.push(ch);
        childrenMap.set(ch.parentId, list);
      }
    }
    const usersByChannel = new Map<number, UserInfo[]>();
    for (const u of Object.values(users)) {
      const list = usersByChannel.get(u.channelId) ?? [];
      list.push(u);
      usersByChannel.set(u.channelId, list);
    }
    return { childrenMap, usersByChannel, roots };
  }, [channels, users]);

  const rootChannel = roots[0];
  const topLevel = rootChannel ? (childrenMap.get(rootChannel.id) ?? []) : [];

  return (
    <div
      data-testid="channel-sidebar"
      className="flex h-full w-full min-w-0 shrink-0 flex-col bg-ink-900"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="py-3 pr-1">
          <div className="px-3 pb-1.5 text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t("shell.voiceChannels")}
          </div>
          {rootChannel && (
            <>
              {/* 根频道本身也可进入 */}
              <ChannelNode
                channel={rootChannel}
                childrenMap={new Map()}
                usersByChannel={usersByChannel}
                depth={0}
                onNavigate={onNavigate}
              />
              {topLevel.map((ch) => (
                <ChannelNode
                  key={ch.id}
                  channel={ch}
                  childrenMap={childrenMap}
                  usersByChannel={usersByChannel}
                  depth={0}
                  onNavigate={onNavigate}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
