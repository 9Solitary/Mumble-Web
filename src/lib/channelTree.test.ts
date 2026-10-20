import { describe, expect, it } from "vitest";
import { buildChannelTree } from "./channelTree";
import type { ChannelInfo } from "./protocol";

function channel(
  id: number,
  parentId: number,
  position: number,
  name = `频道 ${id}`,
): ChannelInfo {
  return { id, parentId, name, position, temporary: false };
}

describe("buildChannelTree", () => {
  it("按 position/id 排序并深度优先展开", () => {
    const tree = buildChannelTree({
      3: channel(3, 1, 2, "设计"),
      2: channel(2, 1, 1, "闲聊"),
      1: channel(1, 0, 1, "语音区"),
      0: channel(0, -1, 0, "大厅"),
      5: channel(5, 3, 1, "插画"),
      4: channel(4, 0, 2, "开黑房"),
    });

    expect(tree.root?.id).toBe(0);
    expect(tree.roots.map((c) => c.id)).toEqual([0]);
    expect(tree.childrenMap.get(0)?.map((c) => c.id)).toEqual([1, 4]);
    expect(tree.childrenMap.get(1)?.map((c) => c.id)).toEqual([2, 3]);
    expect(tree.ordered.map((c) => c.id)).toEqual([0, 1, 2, 3, 5, 4]);
  });

  it("父频道缺失时把频道提升为根，不丢节点", () => {
    const tree = buildChannelTree({
      0: channel(0, -1, 0, "大厅"),
      7: channel(7, 999, 1, "孤儿"),
      8: channel(8, 7, 1, "孤儿子频道"),
    });

    expect(tree.roots.map((c) => c.id)).toEqual([0, 7]);
    expect(tree.root).toBeNull();
    expect(tree.ordered.map((c) => c.id)).toEqual([0, 7, 8]);
  });

  it("多个根频道时不强行指定唯一 root", () => {
    const tree = buildChannelTree({
      1: channel(1, -1, 1, "根 A"),
      2: channel(2, -1, 2, "根 B"),
    });

    expect(tree.root).toBeNull();
    expect(tree.ordered.map((c) => c.id)).toEqual([1, 2]);
  });

  it("空频道返回空树", () => {
    const tree = buildChannelTree({});
    expect(tree.root).toBeNull();
    expect(tree.roots).toEqual([]);
    expect(tree.ordered).toEqual([]);
  });
});
