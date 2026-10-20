import { create } from "zustand";

// 纯展示层状态：不保存消息/网络数据，供标题未读与聊天视图共用。
interface UiState {
  viewChannelId: number;
  unreadCount: number;
  setViewChannelId: (id: number) => void;
  setUnreadCount: (count: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  viewChannelId: 0,
  unreadCount: 0,
  setViewChannelId: (id) => set({ viewChannelId: id }),
  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),
}));
