import type { ReactNode } from "react";
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
  const { self, volumes, setVolume, localMuted, toggleLocalMute } =
    useAppStore();
  if (self?.session === user.session) return <>{children}</>;

  const volume = volumes[user.session] ?? 1;
  const muted = !!localMuted[user.session];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64 bg-[#111214] border-[#3f4147] text-[#dbdee1]">
        <div className="px-2 pt-2 pb-1">
          <div className="flex items-center gap-2 text-xs text-[#b5bac1]">
            <Volume2 className="w-4 h-4" />
            <span className="font-bold uppercase truncate">
              音量 · {user.name}
            </span>
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
        </div>
        <ContextMenuSeparator className="bg-[#3f4147]" />
        <ContextMenuCheckboxItem
          checked={muted}
          onCheckedChange={() => toggleLocalMute(user.session)}
          className="focus:bg-[#35373c] focus:text-white"
        >
          屏蔽此用户发言
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
