import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { Volume2 } from "lucide-react";
import type { UserInfo } from "@/lib/protocol";

// 其他用户的右键菜单：调节其输出音量 / 本地屏蔽其发言。
// 本人不弹菜单，直接透传 children。
export function UserContextMenu({
  user,
  children,
}: {
  user: UserInfo;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { self, volumes, setVolume, localMuted, toggleLocalMute } =
    useAppStore();
  if (self?.session === user.session) return <>{children}</>;

  const volume = volumes[user.session] ?? 1;
  const muted = !!localMuted[user.session];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64 border-line-control bg-ink-900 text-fg">
        <div className="px-2 pb-1 pt-2">
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
        </div>
        <ContextMenuSeparator className="bg-ink-700" />
        <ContextMenuCheckboxItem
          checked={muted}
          onCheckedChange={() => toggleLocalMute(user.session)}
          className="focus:bg-ink-700 focus:text-fg"
        >
          {t("member.localMute")}
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
