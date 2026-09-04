import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatArea } from "@/components/ChatArea";
import { MemberList } from "@/components/MemberList";
import { UserBar } from "@/components/UserBar";
import { RemoteAudio } from "@/components/RemoteAudio";

// 登录就绪后的主界面（频道树 + 聊天 + 成员列表），普通模式与邀请模式共用
export function MainLayout() {
  return (
    <div className="h-screen w-screen flex bg-[#313338] text-[#dbdee1] overflow-hidden">
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
