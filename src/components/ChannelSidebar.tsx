import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { buildChannelTree } from "@/lib/channelTree";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./UserAvatar";
import { UserContextMenu } from "./UserContextMenu";
import { TalkingBars } from "./TalkingBars";
import {
  ChevronRight,
  Crown,
  HeadphoneOff,
  LogIn,
  MicOff,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ChannelInfo, UserInfo } from "@/lib/protocol";

function VoiceUserRow({
  user,
  depth,
  prefix,
}: {
  user: UserInfo;
  depth: number;
  prefix: string;
}) {
  const { t } = useTranslation();
  const talking = useAppStore((s) =>
    s.self?.session === user.session
      ? s.selfTalking
      : !!s.talking[user.session],
  );
  const locallyMuted = useAppStore((s) => !!s.localMuted[user.session]);
  const silenced = user.selfMuted || user.muted || user.suppressed;
  const deafened = user.selfDeafened || user.deafened;

  return (
    <UserContextMenu user={user}>
      <div
        data-testid={`${prefix}channel-user-${user.session}`}
        className="mx-1 flex min-h-11 items-center gap-2 rounded-md py-1 pr-2 text-fg-subtle transition-colors hover:bg-ink-800 hover:text-fg-muted md:min-h-8"
        style={{ paddingLeft: `${36 + depth * 12}px` }}
      >
        <UserAvatar
          name={user.name}
          size={22}
          talking={talking}
          muted={silenced}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-caption",
            talking ? "text-fg" : silenced ? "text-fg-subtle" : "text-fg-muted",
          )}
        >
          {user.name}
        </span>
        {talking && <TalkingBars />}
        {user.prioritySpeaker && (
          <Crown className="size-3.5 shrink-0 text-amber-bright" aria-hidden="true" />
        )}
        {locallyMuted && (
          <VolumeX className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
        )}
        {deafened && (
          <HeadphoneOff className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
        )}
        {silenced && (
          <MicOff className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
        )}
        {talking && <span className="sr-only">{t("member.statusTalking")}</span>}
        {locallyMuted && (
          <span className="sr-only">{t("member.statusSilenced")}</span>
        )}
        {deafened && (
          <span className="sr-only">{t("member.statusDeafened")}</span>
        )}
        {silenced && <span className="sr-only">{t("member.statusMuted")}</span>}
        {user.prioritySpeaker && (
          <span className="sr-only">{t("member.prioritySpeaker")}</span>
        )}
      </div>
    </UserContextMenu>
  );
}

function ChannelNode({
  channel,
  childrenMap,
  usersByChannel,
  depth,
  viewChannelId,
  unreadChannels,
  collapsedChannels,
  onToggleCollapse,
  onNavigate,
  prefix,
  renderChildren = true,
}: {
  channel: ChannelInfo;
  childrenMap: Map<number, ChannelInfo[]>;
  usersByChannel: Map<number, UserInfo[]>;
  depth: number;
  viewChannelId: number;
  unreadChannels?: Set<number>;
  collapsedChannels?: Set<number>;
  onToggleCollapse?: (channelId: number) => void;
  onNavigate?: () => void;
  prefix: string;
  renderChildren?: boolean;
}) {
  const { t } = useTranslation();
  const { self, selectChannel, joinChannel } = useAppStore();
  const children = childrenMap.get(channel.id) ?? [];
  const occupants = usersByChannel.get(channel.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedChannels?.has(channel.id) ?? false;
  const isViewed = viewChannelId === channel.id;
  const isJoined = self?.channelId === channel.id;
  const isUnread = !!unreadChannels?.has(channel.id) && !isViewed;
  const nameId = `channel-name-${prefix}${channel.id}`;

  return (
    <div>
      <div
        className={cn(
          "group/channel mx-1 flex items-stretch rounded-md transition-colors",
          isViewed
            ? "bg-mint/10 text-fg shadow-rail"
            : "text-fg-subtle hover:bg-ink-800 hover:text-fg",
        )}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse?.(channel.id)}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed ? t("channel.expand") : t("channel.collapse")
            }
            aria-describedby={nameId}
            data-testid={`${prefix}channel-toggle-${channel.id}`}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/70 md:h-8 md:w-7"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-fast",
                !isCollapsed && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span className="w-9 shrink-0 md:w-7" />
        )}

        <button
          type="button"
          onClick={() => selectChannel(channel.id)}
          onDoubleClick={() => {
            joinChannel(channel.id);
            onNavigate?.();
          }}
          aria-current={isViewed ? "page" : undefined}
          title={t("shell.channelTitle", {
            name: channel.description || channel.name,
          })}
          data-testid={`${prefix}channel-${channel.id}`}
          data-viewed={isViewed}
          data-joined={isJoined}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 text-left select-none md:min-h-8"
        >
          <Volume2
            className={cn(
              "size-4 shrink-0",
              isJoined ? "text-mint" : "opacity-60",
            )}
            aria-hidden="true"
          />
          <span
            id={nameId}
            className={cn(
              "min-w-0 flex-1 truncate text-ui",
              isJoined && "font-semibold",
            )}
          >
            {channel.name}
          </span>
          {isJoined && <span className="sr-only">{t("channel.joined")}</span>}
          {occupants.length > 0 && (
            <span className="shrink-0 font-mono text-data text-fg-subtle">
              {occupants.length}
            </span>
          )}
          {isUnread && (
            <span
              data-testid={`${prefix}channel-unread-${channel.id}`}
              className="size-1.5 shrink-0 rounded-full bg-amber shadow-[0_0_0_3px_rgb(var(--amber)/0.12)]"
            >
              <span className="sr-only">{t("channel.unread")}</span>
            </span>
          )}
        </button>

        {!isJoined && (
          <button
            type="button"
            onClick={() => {
              joinChannel(channel.id);
              onNavigate?.();
            }}
            aria-label={t("channel.joinVoice")}
            aria-describedby={nameId}
            data-testid={`${prefix}channel-join-${channel.id}`}
            className="my-1 mr-1 hidden size-7 shrink-0 place-items-center rounded-md text-mint transition-colors hover:bg-mint/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/70 md:group-hover/channel:grid md:group-focus-within/channel:grid"
          >
            <LogIn className="size-4" />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div>
          {occupants.map((user) => (
            <VoiceUserRow
              key={user.session}
              user={user}
              depth={depth}
              prefix={prefix}
            />
          ))}
          {renderChildren &&
            children.map((child) => (
              <ChannelNode
                key={child.id}
                channel={child}
                childrenMap={childrenMap}
                usersByChannel={usersByChannel}
                depth={depth + 1}
                viewChannelId={viewChannelId}
                unreadChannels={unreadChannels}
                collapsedChannels={collapsedChannels}
                onToggleCollapse={onToggleCollapse}
                onNavigate={onNavigate}
                prefix={prefix}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function ChannelSidebar({
  onNavigate,
  viewChannelId = 0,
  unreadChannels,
  collapsedChannels,
  onToggleCollapse,
  instanceId,
  testId = "channel-sidebar",
}: {
  onNavigate?: () => void;
  viewChannelId?: number;
  unreadChannels?: Set<number>;
  collapsedChannels?: Set<number>;
  onToggleCollapse?: (channelId: number) => void;
  instanceId?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const { channels, users } = useAppStore();

  const { root, roots, childrenMap, ordered, usersByChannel } = useMemo(() => {
    const tree = buildChannelTree(channels);
    const byChannel = new Map<number, UserInfo[]>();
    for (const user of Object.values(users)) {
      const list = byChannel.get(user.channelId) ?? [];
      list.push(user);
      byChannel.set(user.channelId, list);
    }
    return { ...tree, usersByChannel: byChannel };
  }, [channels, users]);

  const topLevel = root ? (childrenMap.get(root.id) ?? []) : roots;
  const prefix = instanceId ? `${instanceId}-` : "";
  const rootCollapsed = root
    ? (collapsedChannels?.has(root.id) ?? false)
    : false;

  return (
    <div
      data-testid={testId}
      className="flex h-full w-full min-w-0 shrink-0 flex-col bg-ink-900"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="py-3 pr-1">
          <div className="flex items-baseline justify-between px-3 pb-1.5">
            <span className="text-micro font-semibold uppercase tracking-[0.12em] text-fg-subtle">
              {t("shell.voiceChannels")}
            </span>
            {ordered.length > 0 && (
              <span className="font-mono text-data text-fg-subtle">
                {ordered.length}
              </span>
            )}
          </div>

          {ordered.length === 0 && (
            <div className="px-4 py-8 text-center text-caption text-fg-subtle">
              <Radio
                className="mx-auto mb-2 size-5 opacity-60"
                aria-hidden="true"
              />
              {t("channel.empty")}
            </div>
          )}

          {root && (
            <>
              <ChannelNode
                channel={root}
                childrenMap={childrenMap}
                usersByChannel={usersByChannel}
                depth={0}
                viewChannelId={viewChannelId}
                unreadChannels={unreadChannels}
                collapsedChannels={collapsedChannels}
                onToggleCollapse={onToggleCollapse}
                onNavigate={onNavigate}
                prefix={prefix}
                renderChildren={false}
              />
              {!rootCollapsed &&
                topLevel.map((channel) => (
                  <ChannelNode
                    key={channel.id}
                    channel={channel}
                    childrenMap={childrenMap}
                    usersByChannel={usersByChannel}
                    depth={0}
                    viewChannelId={viewChannelId}
                    unreadChannels={unreadChannels}
                    collapsedChannels={collapsedChannels}
                    onToggleCollapse={onToggleCollapse}
                    onNavigate={onNavigate}
                    prefix={prefix}
                  />
                ))}
            </>
          )}

          {!root &&
            roots.map((channel) => (
              <ChannelNode
                key={channel.id}
                channel={channel}
                childrenMap={childrenMap}
                usersByChannel={usersByChannel}
                depth={0}
                viewChannelId={viewChannelId}
                unreadChannels={unreadChannels}
                collapsedChannels={collapsedChannels}
                onToggleCollapse={onToggleCollapse}
                onNavigate={onNavigate}
                prefix={prefix}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
