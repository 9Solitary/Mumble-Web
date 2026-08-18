import { useAppStore } from "@/store/appStore";
import { ConnectScreen } from "@/components/ConnectScreen";
import { ChannelSidebar } from "@/components/ChannelSidebar";
import { ChatArea } from "@/components/ChatArea";
import { MemberList } from "@/components/MemberList";
import { UserBar } from "@/components/UserBar";
import { RemoteAudio } from "@/components/RemoteAudio";
import { Loader2 } from "lucide-react";

export default function App() {
  const connState = useAppStore((s) => s.connState);

  if (connState === "idle" || connState === "failed" || connState === "connecting") {
    return <ConnectScreen />;
  }

  if (connState === "connected") {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center gap-3 text-[#b5bac1]">
        <Loader2 className="w-8 h-8 animate-spin text-[#5865f2]" />
        <p className="text-sm">正在同步频道与用户…</p>
      </div>
    );
  }

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
