import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "./UserAvatar";
import { UserContextMenu } from "./UserContextMenu";
import { MicOff, HeadphoneOff, Volume2, VolumeX } from "lucide-react";
import type { UserInfo } from "@/lib/protocol";

function MemberRow({ user }: { user: UserInfo }) {
  const { t } = useTranslation();
  const { self, talking, selfTalking, volumes, setVolume, remoteStreams, localMuted } =
    useAppStore();
  const isSelf = self?.session === user.session;
  const isTalking = isSelf ? selfTalking : !!talking[user.session];
  const silenced = user.selfMuted || user.muted || user.suppressed;
  const hasAudio = !!remoteStreams[user.session];
  const volume = volumes[user.session] ?? 1;
  const locallyMuted = !!localMuted[user.session];

  const row = (
    <div className="flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-md hover:bg-ink-800 cursor-pointer">
      <UserAvatar name={user.name} size={32} talking={isTalking} muted={silenced} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm truncate ${silenced ? "text-fg-subtle" : "text-fg"}`}>
          {user.name}
          {isSelf && (
            <span className="text-fg-subtle text-xs">{t("member.self")}</span>
          )}
        </div>
        {user.comment && (
          <div className="text-[11px] text-fg-subtle truncate">{user.comment}</div>
        )}
      </div>
      {locallyMuted && <VolumeX className="w-4 h-4 text-danger shrink-0" />}
      {(user.selfDeafened || user.deafened) && (
        <HeadphoneOff className="w-4 h-4 text-danger shrink-0" />
      )}
      {silenced && <MicOff className="w-4 h-4 text-danger shrink-0" />}
    </div>
  );

  // 远端用户可弹出音量调节；自己不需要
  if (isSelf || !hasAudio) {
    return <UserContextMenu user={user}>{row}</UserContextMenu>;
  }
  return (
    <Popover>
      <UserContextMenu user={user}>
        <PopoverTrigger asChild>{row}</PopoverTrigger>
      </UserContextMenu>
      <PopoverContent
          side="left"
          className="w-60 border-line-control bg-ink-900 text-fg"
        >
          <div className="flex items-center gap-2">
            <Volume2 className="size-3.5 shrink-0 text-fg-muted" />
            <span className="truncate text-[11px] font-medium text-fg">
              {t("member.volume", { name: user.name })}
            </span>
          </div>
          <Slider
            className="mt-2"
            aria-label={t("member.volume", { name: user.name })}
            value={[volume * 100]}
            min={0}
            max={150}
            step={1}
            onValueChange={([v]) => setVolume(user.session, v / 100)}
          />
          <div className="mt-1 text-right font-mono text-[10.5px] text-fg-muted">
            {Math.round(volume * 100)}%
          </div>
        </PopoverContent>
    </Popover>
  );
}

export function MemberList() {
  const { t } = useTranslation();
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
        name:
          channels[cid]?.name ??
          t("member.channelFallback", { cid: String(cid) }),
        users: us.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels, users, t]);

  return (
    <div data-testid="member-list" className="hidden w-member shrink-0 flex-col border-l border-line bg-ink-900 min-[1180px]:flex">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="py-3">
          {groups.map((g) => (
            <div key={g.name} className="mb-3">
              <div className="px-3 pb-1 text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle truncate">
                {g.name} — {g.users.length}
              </div>
              {g.users.map((u) => (
                <MemberRow key={u.session} user={u} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
