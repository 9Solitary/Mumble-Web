import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "./UserAvatar";
import { MicOff, HeadphoneOff, Volume2 } from "lucide-react";
import type { UserInfo } from "@/lib/protocol";

function MemberRow({ user }: { user: UserInfo }) {
  const { self, talking, volumes, setVolume, remoteStreams } = useAppStore();
  const isSelf = self?.session === user.session;
  const isTalking = !!talking[user.session];
  const silenced = user.selfMuted || user.muted || user.suppressed;
  const hasAudio = !!remoteStreams[user.session];
  const volume = volumes[user.session] ?? 1;

  const row = (
    <div className="flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-md hover:bg-[#35373c] cursor-pointer">
      <UserAvatar name={user.name} size={32} talking={isTalking} muted={silenced} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm truncate ${silenced ? "text-[#6d6f78]" : "text-[#dbdee1]"}`}>
          {user.name}
          {isSelf && <span className="text-[#6d6f78] text-xs">（我）</span>}
        </div>
        {user.comment && (
          <div className="text-[11px] text-[#6d6f78] truncate">{user.comment}</div>
        )}
      </div>
      {(user.selfDeafened || user.deafened) && (
        <HeadphoneOff className="w-4 h-4 text-[#fa777c] shrink-0" />
      )}
      {silenced && <MicOff className="w-4 h-4 text-[#fa777c] shrink-0" />}
    </div>
  );

  // 远端用户可弹出音量调节；自己不需要
  if (isSelf || !hasAudio) return row;
  return (
    <Popover>
      <PopoverTrigger asChild>{row}</PopoverTrigger>
      <PopoverContent
        side="left"
        className="w-56 bg-[#111214] border-[#3f4147] text-[#dbdee1]"
      >
        <div className="flex items-center gap-2 text-xs text-[#b5bac1]">
          <Volume2 className="w-4 h-4" />
          <span className="font-bold uppercase">音量 · {user.name}</span>
        </div>
        <Slider
          className="mt-3"
          value={[volume * 100]}
          min={0}
          max={150}
          step={5}
          onValueChange={([v]) => setVolume(user.session, v / 100)}
        />
        <div className="mt-1 text-right text-xs text-[#949ba4]">
          {Math.round(volume * 100)}%
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MemberList() {
  const { channels, users } = useAppStore();

  const groups = useMemo(() => {
    const byChannel = new Map<number, UserInfo[]>();
    for (const u of Object.values(users)) {
      const list = byChannel.get(u.channelId) ?? [];
      list.push(u);
      byChannel.set(u.channelId, list);
    }
    // 只展示有用户的频道，按频道名排序
    return [...byChannel.entries()]
      .map(([cid, us]) => ({
        name: channels[cid]?.name ?? `频道 ${cid}`,
        users: us.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels, users]);

  return (
    <div className="w-60 bg-[#2b2d31] shrink-0 hidden lg:flex flex-col">
      <ScrollArea className="flex-1">
        <div className="py-3">
          {groups.map((g) => (
            <div key={g.name} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-bold uppercase text-[#949ba4] tracking-wide truncate">
                {g.name} — {g.users.length}
              </div>
              {g.users.map((u) => (
                <MemberRow key={u.session} user={u} />
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
