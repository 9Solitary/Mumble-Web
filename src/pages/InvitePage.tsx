import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useAppStore } from "@/store/appStore";
import { ConnectScreen } from "@/components/ConnectScreen";
import { MainLayout } from "@/components/MainLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Headphones, Loader2 } from "lucide-react";

// 一次性邀请链接入口：校验 token -> 仅需用户名的连接表单 -> 主界面。
// token 的服务器/密码保存在代理服务端，本页面拿不到也不需要。
export function InvitePage() {
  const { token = "" } = useParams();
  const connState = useAppStore((s) => s.connState);
  const inviteToken = useAppStore((s) => s.inviteToken);
  const [check, setCheck] = useState<"checking" | "valid" | "invalid">("checking");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.valid) {
          setCheck("valid");
        } else {
          setCheck("invalid");
          setReason(d?.reason || "邀请链接无效、已过期或已被使用");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCheck("invalid");
        setReason("无法连接代理服务器");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 本标签页已发起邀请连接：跟随连接状态渲染（被拒时回到表单并展示错误）
  if (inviteToken === token && connState !== "idle") {
    if (connState === "ready") return <MainLayout />;
    if (connState === "connected") {
      return (
        <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center gap-3 text-[#b5bac1]">
          <Loader2 className="w-8 h-8 animate-spin text-[#5865f2]" />
          <p className="text-sm">正在同步频道与用户…</p>
        </div>
      );
    }
    return <ConnectScreen inviteToken={token} />;
  }

  if (check === "checking") {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center gap-3 text-[#b5bac1]">
        <Loader2 className="w-8 h-8 animate-spin text-[#5865f2]" />
        <p className="text-sm">正在校验邀请链接…</p>
      </div>
    );
  }

  if (check === "invalid") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#1e1f22]">
        <Card className="w-[400px] bg-[#2b2d31] border-[#3f4147] text-[#dbdee1] shadow-2xl">
          <CardHeader className="items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#fa777c]/20 flex items-center justify-center mb-2">
              <Headphones className="w-8 h-8 text-[#fa777c]" />
            </div>
            <CardTitle className="text-2xl text-white">邀请链接已失效</CardTitle>
            <CardDescription className="text-[#b5bac1]">{reason}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-[#6d6f78]">
            邀请为一次性且限时有效，请联系邀请方重新生成。
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ConnectScreen inviteToken={token} />;
}
