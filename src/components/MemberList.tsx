import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { buildChannelTree } from "@/lib/channelTree";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserAvatar } from "./UserAvatar";
import { UserContextMenu } from "./UserContextMenu";
import { TalkingBars } from "./TalkingBars";
import {
  HeadphoneOff,
  MicOff,
  Search,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { UserInfo } from "@/lib/protocol";

type MemberListVariant = "sidebar" | "drawer";

function MemberRow({
  user,
  prefix,
}: {
  user: UserInfo;
  prefix: string;
}) {
  const { t } = useTranslation();
  const {
    self,
    talking,
    selfTalking,
    volumes,
    setVolume,
    localMuted,
  } = useAppStore();
  const isSelf = self?.session === user.session;
  const isTalking = isSelf ? selfTalking : !!talking[user.session];
  const silenced = user.selfMuted || user.muted || user.suppressed;
  const deafened = user.selfDeafened || user.deafened;
  const locallyMuted = !!localMuted[user.session];
  const volume = volumes[user.session] ?? 1;
  const canAdjustVolume = !isSelf;

  const status = isTalking
    ? t("member.statusTalking")
    : locallyMuted
      ? t("member.statusSilenced")
      : deafened
        ? t("member.statusDeafened")
        : silenced
          ? t("member.statusMuted")
          : t("member.statusOnline");

  const row = (
    <div
      data-testid={`${prefix}member-row-${user.session}`}
      className="group/member mx-1 flex min-h-11 items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-ink-800 md:min-h-[38px]"
    >
      <UserAvatar
        name={user.name}
        size={32}
        talking={isTalking}
        muted={silenced}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={`truncate text-ui font-medium ${
              silenced ? "text-fg-subtle" : "text-fg"
            }`}
          >
            {user.name}
          </span>
          {isSelf && (
            <span className="shrink-0 text-data text-fg-subtle">
              {t("member.self")}
            </span>
          )}
        </div>
        <div
          className={`truncate text-data ${
            isTalking ? "text-mint" : "text-fg-subtle"
          }`}
        >
          {status}
        </div>
      </div>

      {isTalking && <TalkingBars />}
      {locallyMuted && (
        <VolumeX
          className="size-4 shrink-0 text-danger"
          aria-hidden="true"
        />
      )}
      {deafened && (
        <HeadphoneOff
          className="size-4 shrink-0 text-danger"
          aria-hidden="true"
        />
      )}
      {silenced && (
        <MicOff className="size-4 shrink-0 text-danger" aria-hidden="true" />
      )}

      {canAdjustVolume && (
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={`${prefix}member-volume-${user.session}`}
            aria-label={t("member.volume", { name: user.name })}
            title={t("member.volume", { name: user.name })}
            className="grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-ink-700 hover:text-fg md:size-8"
          >
            <Volume2 className="size-4" />
          </button>
        </PopoverTrigger>
      )}
    </div>
  );

  if (!canAdjustVolume) {
    return <UserContextMenu user={user}>{row}</UserContextMenu>;
  }

  return (
    <Popover>
      <UserContextMenu user={user}>{row}</UserContextMenu>
      <PopoverContent
        side="left"
        align="center"
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
          onValueChange={([value]) => setVolume(user.session, value / 100)}
        />
        <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] text-fg-muted">
          <span>{Math.round(volume * 100)}%</span>
          {volume === 0 && (
            <span className="text-danger">{t("userbar.zeroMute")}</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MemberList({
  variant = "sidebar",
  focusSearchSignal = 0,
}: {
  variant?: MemberListVariant;
  focusSearchSignal?: number;
}) {
  const { t, i18n } = useTranslation();
  const { channels, users, self } = useAppStore();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const isDrawer = variant === "drawer";
  const prefix = isDrawer ? "drawer-" : "";
  const query = search.trim().toLocaleLowerCase(i18n.language);

  useEffect(() => {
    if (!focusSearchSignal) return;
    // 抽屉打开动画期间先等一帧；只有可见实例接管焦点。
    const timer = window.setTimeout(() => {
      const el = searchRef.current;
      if (el && el.offsetParent !== null) el.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusSearchSignal]);

  const ordered = useMemo(
    () => buildChannelTree(channels).ordered,
    [channels],
  );

  const groups = useMemo(() => {
    const byChannel = new Map<number, UserInfo[]>();
    for (const user of Object.values(users)) {
      const list = byChannel.get(user.channelId) ?? [];
      list.push(user);
      byChannel.set(user.channelId, list);
    }

    const sortUsers = (list: UserInfo[]) =>
      [...list].sort((a, b) => {
        if (a.session === self?.session) return -1;
        if (b.session === self?.session) return 1;
        return a.name.localeCompare(b.name, i18n.language);
      });

    const result: { id: number; name: string; users: UserInfo[] }[] = [];
    const seen = new Set<number>();
    for (const channel of ordered) {
      const list = byChannel.get(channel.id);
      if (!list?.length) continue;
      result.push({ id: channel.id, name: channel.name, users: sortUsers(list) });
      seen.add(channel.id);
    }
    for (const [channelId, list] of byChannel) {
      if (seen.has(channelId) || !list.length) continue;
      result.push({
        id: channelId,
        name:
          channels[channelId]?.name ??
          t("member.channelFallback", { cid: String(channelId) }),
        users: sortUsers(list),
      });
    }
    return result;
  }, [channels, ordered, users, self?.session, i18n.language, t]);

  const filteredGroups = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        users: group.users.filter((user) => {
          const name = user.name.toLocaleLowerCase(i18n.language);
          const comment = (user.comment ?? "").toLocaleLowerCase(
            i18n.language,
          );
          return name.includes(query) || comment.includes(query);
        }),
      }))
      .filter((group) => group.users.length > 0);
  }, [groups, query, i18n.language]);

  const total = Object.keys(users).length;
  const hasResults = filteredGroups.length > 0;

  return (
    <aside
      data-testid={isDrawer ? "member-list-drawer" : "member-list"}
      aria-label={t("member.title")}
      className={
        isDrawer
          ? "flex h-full w-full min-w-0 flex-col bg-ink-900"
          : "hidden w-member shrink-0 flex-col border-l border-line bg-ink-900 min-[1180px]:flex"
      }
    >
      <div className="shrink-0 border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
            {t("member.online")}
          </span>
          <span className="font-mono text-data text-fg-subtle">{total}</span>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid={`${prefix}member-search`}
            aria-label={t("member.searchPlaceholder")}
            placeholder={t("member.searchPlaceholder")}
            className="h-9 w-full rounded-control border border-line-control bg-ink-950/60 pl-8 pr-8 text-caption text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-mint/50 focus:ring-2 focus:ring-mint/15"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              data-testid={`${prefix}member-search-clear`}
              aria-label={t("member.searchClear")}
              className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-fg-subtle transition-colors hover:bg-ink-800 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {hasResults ? (
          filteredGroups.map((group) => (
            <div
              key={group.id}
              data-testid={`${prefix}member-group-${group.id}`}
              className="mb-2"
            >
              <div className="flex items-baseline justify-between gap-2 px-3 pb-1">
                <span className="truncate text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                  {group.name}
                </span>
                <span className="shrink-0 font-mono text-data text-fg-subtle">
                  {group.users.length}
                </span>
              </div>
              {group.users.map((user) => (
                <MemberRow
                  key={user.session}
                  user={user}
                  prefix={prefix}
                />
              ))}
            </div>
          ))
        ) : (
          <div role="status" className="px-4 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-fg/[0.04]">
              <Users className="size-5 text-fg-subtle" aria-hidden="true" />
            </div>
            <p className="text-caption font-medium text-fg-muted">
              {query ? t("member.noResults") : t("member.empty")}
            </p>
            {query && (
              <button
                type="button"
                onClick={() => setSearch("")}
                data-testid={`${prefix}member-no-results-clear`}
                className="mt-2 text-caption text-mint hover:underline"
              >
                {t("member.searchClear")}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
