import { useEffect, useMemo, useState } from "react";

import { useAppStore } from "@/store/appStore";

// 未读点只在本次登录会话内有效：
// - 查看中的频道始终视为已读；
// - 其他频道有消息多过上次已读数量时标记未读；
// - 进入频道后清除。
// 不持久化、不写服务端，也不改 appStore 的消息逻辑。
export function useUnreadChannels(viewChannelId: number): Set<number> {
  const messages = useAppStore((s) => s.messages);
  const [readCounts, setReadCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    // 已读水位由消息/频道变化驱动，必须同步更新才能让未读点立即消失。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadCounts((previous) => {
      const count = messages[viewChannelId]?.length ?? 0;
      if ((previous[viewChannelId] ?? 0) === count) return previous;
      return { ...previous, [viewChannelId]: count };
    });
  }, [messages, viewChannelId]);

  return useMemo(() => {
    const unread = new Set<number>();
    for (const [key, list] of Object.entries(messages)) {
      const channelId = Number(key);
      if (channelId === viewChannelId) continue;
      if (list.length > (readCounts[channelId] ?? 0)) unread.add(channelId);
    }
    return unread;
  }, [messages, readCounts, viewChannelId]);
}
