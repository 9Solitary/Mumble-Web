import { Route, Routes } from "react-router";
import { useAppStore } from "@/store/appStore";
import { ConnectScreen } from "@/components/ConnectScreen";
import { MainLayout } from "@/components/MainLayout";
import { InvitePage } from "@/pages/InvitePage";
import { Loader2 } from "lucide-react";

// 普通连接流程：按连接状态在登录页 / 同步中 / 主界面之间切换
function HomeFlow() {
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

  return <MainLayout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="*" element={<HomeFlow />} />
    </Routes>
  );
}
