import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "./UserAvatar";
import { Volume2, MicOff, HeadphoneOff, Crown, ChevronRight } from "lucide-react";
import type { ChannelInfo, UserInfo } from "@/lib/protocol";

function VoiceUserRow({ user }: { user: UserInfo }) {
  const talking = useAppStore((s) => s.talking[user.session]);
  const silenced = user.selfMuted || user.muted || user.suppressed;
  return (
    <div className="flex items-center gap-2 pl-8 pr-3 py-1 rounded-md mx-1 hover:bg-[#35373c] cursor-default group">
      <UserAvatar name={user.name} size={24} talking={!!talking} muted={silenced} />
      <span
        className={`text-sm truncate flex-1 ${
          talking ? "text-white" : silenced ? "text-[#6d6f78]" : "text-[#b5bac1]"
        }`}
      >
        {user.name}
      </span>
      {user.prioritySpeaker && <Crown className="w-3.5 h-3.5 text-[#fee75c]" />}
      {(user.selfDeafened || user.deafened) && (
        <HeadphoneOff className="w-3.5 h-3.5 text-[#fa777c]" />
      )}
      {silenced && <MicOff className="w-3.5 h-3.5 text-[#fa777c]" />}
    </div>
  );
}

function ChannelNode({
  channel,
  childrenMap,
  usersByChannel,
  depth,
}: {
  channel: ChannelInfo;
  childrenMap: Map<number, ChannelInfo[]>;
  usersByChannel: Map<number, UserInfo[]>;
  depth: number;
}) {
  const { self, currentChannelId, joinChannel } = useAppStore();
  const occupants = usersByChannel.get(channel.id) ?? [];
  const isSelfHere = self?.channelId === channel.id;
  const isCurrent = currentChannelId === channel.id;
  const children = childrenMap.get(channel.id) ?? [];

  return (
    <div>
      <button
        onClick={() => joinChannel(channel.id)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded-md text-left group transition-colors ${
          isCurrent ? "bg-[#404249] text-white" : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
        }`}
        style={{ width: "calc(100% - 8px)", paddingLeft: `${8 + depth * 12}px` }}
        title={channel.description || channel.name}
      >
        {children.length > 0 ? (
          <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />
        ) : (
          <span className="w-3" />
        )}
        <Volume2 className="w-4 h-4 shrink-0 opacity-70" />
        <span className={`text-sm truncate flex-1 ${isSelfHere ? "font-semibold" : ""}`}>
          {channel.name}
        </span>
        {occupants.length > 0 && (
          <span className="text-xs text-[#6d6f78]">{occupants.length}</span>
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
        />
      ))}
    </div>
  );
}

export function ChannelSidebar() {
  const { channels, users, server } = useAppStore();

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
    <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0">
      <div className="h-12 px-4 flex items-center border-b border-[#1e1f22] shadow-sm">
        <h1 className="font-bold text-white text-sm truncate">
          {rootChannel?.name || server?.address || "Mumble 服务器"}
        </h1>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2 pr-1">
          <div className="px-3 pb-1 text-[11px] font-bold uppercase text-[#949ba4] tracking-wide">
            语音频道
          </div>
          {rootChannel && (
            <>
              {/* 根频道本身也可进入 */}
              <ChannelNode
                channel={rootChannel}
                childrenMap={new Map()}
                usersByChannel={usersByChannel}
                depth={0}
              />
              {topLevel.map((ch) => (
                <ChannelNode
                  key={ch.id}
                  channel={ch}
                  childrenMap={childrenMap}
                  usersByChannel={usersByChannel}
                  depth={0}
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
