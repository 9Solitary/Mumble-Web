import type { ChannelInfo } from "@/lib/protocol";

// 频道树是 UI 侧的唯一排序来源：先按 position，再按 id，保证结果稳定。
// 父频道缺失时把该频道当作根，避免服务端数据短暂不完整时整棵树消失。
export interface ChannelTree {
  root: ChannelInfo | null;
  roots: ChannelInfo[];
  childrenMap: Map<number, ChannelInfo[]>;
  ordered: ChannelInfo[];
}

export function buildChannelTree(
  channels: Record<number, ChannelInfo>,
): ChannelTree {
  const all = Object.values(channels).sort(
    (a, b) => a.position - b.position || a.id - b.id,
  );
  const childrenMap = new Map<number, ChannelInfo[]>();
  const roots: ChannelInfo[] = [];

  for (const channel of all) {
    if (channel.parentId < 0 || !channels[channel.parentId]) {
      roots.push(channel);
      continue;
    }
    const list = childrenMap.get(channel.parentId) ?? [];
    list.push(channel);
    childrenMap.set(channel.parentId, list);
  }

  // 只有一个根频道时，它通常就是“大厅”；UI 会把它当作一级行处理。
  const root = roots.length === 1 ? roots[0] : null;
  const ordered: ChannelInfo[] = [];
  const visit = (channel: ChannelInfo) => {
    ordered.push(channel);
    for (const child of childrenMap.get(channel.id) ?? []) visit(child);
  };
  for (const channel of roots) visit(channel);

  return { root, roots, childrenMap, ordered };
}
