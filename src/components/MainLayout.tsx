import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatArea } from "@/components/ChatArea";
import { MemberList } from "@/components/MemberList";
import { UserBar } from "@/components/UserBar";
import { RemoteAudio } from "@/components/RemoteAudio";
import { useAppStore } from "@/store/appStore";
import { Loader2 } from "lucide-react";

// 登录就绪后的主界面（频道树 + 聊天 + 成员列表），普通模式与邀请模式共用
export function MainLayout() {
  const connState = useAppStore((s) => s.connState);
  const reconnectAttempt = useAppStore((s) => s.reconnectAttempt);

  return (
    <div className="h-screen w-screen flex bg-[#313338] text-[#dbdee1] overflow-hidden relative">
      {/* 断线重连提示条：重连期间保持主界面可见，顶部横条提示 */}
      {connState === "reconnecting" && (
        <div className="absolute top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-[#f0b232] text-[#1e1f22] text-xs font-bold py-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          连接已断开，正在重连
          {reconnectAttempt > 0 ? `（第 ${reconnectAttempt} 次）` : ""}…
        </div>
      )}
      <div className="flex flex-col shrink-0">
        <div className="flex-1 flex min-h-0">
          <ChannelSidebar />
        </div>
        <UserBar />
      </div>
      <ChatArea />
      <MemberList />
      <RemoteAudio />
    </div>
  );
}
