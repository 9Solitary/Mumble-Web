import { useEffect, useState } from "react";
import { loadIdentity, useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Headphones, Loader2 } from "lucide-react";

// "host:port" 拆分；无端口或非数字端口时整体作为 host
function splitHostPort(addr: string): { host: string; port: string } {
  const i = addr.lastIndexOf(":");
  if (i > 0 && /^\d+$/.test(addr.slice(i + 1))) {
    return { host: addr.slice(0, i), port: addr.slice(i + 1) };
  }
  return { host: addr, port: "" };
}

export function ConnectScreen({ inviteToken }: { inviteToken?: string }) {
  const { connState, error, connect } = useAppStore();
  const inviteMode = inviteToken != null;
  const [identity] = useState(loadIdentity);
  const [username, setUsername] = useState(identity.username ?? "");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState(() => splitHostPort(identity.serverAddr ?? "").host);
  const [port, setPort] = useState(() => splitHostPort(identity.serverAddr ?? "").port);
  const [defaultAddr, setDefaultAddr] = useState(""); // 代理默认上游（占位提示用）
  const connecting = connState === "connecting" || connState === "connected";

  // 无本地记忆时，用代理当前配置预填服务器地址（邀请模式不展示服务器，无需预填）
  useEffect(() => {
    if (inviteMode || identity.serverAddr) return;
    let cancelled = false;
    fetch("/api/server")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const addr: string = d.resolved || d.address || "";
        setDefaultAddr(addr);
        if (addr) {
          const p = splitHostPort(addr);
          setHost(p.host);
          setPort(p.port);
        }
      })
      .catch(() => {
        /* 接口不可用时留空，连接时使用代理默认 */
      });
    return () => {
      cancelled = true;
    };
  }, [identity.serverAddr, inviteMode]);

  const portTrim = port.trim();
  const portInvalid =
    portTrim !== "" &&
    (!/^\d+$/.test(portTrim) || Number(portTrim) < 1 || Number(portTrim) > 65535);
  const hostTrim = host.trim();
  const serverAddr = hostTrim
    ? portTrim
      ? `${hostTrim}:${portTrim}`
      : hostTrim
    : "";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#1e1f22] relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#5865f2]/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#23a55a]/15 blur-[120px]" />
      </div>

      <Card className="w-[min(400px,calc(100vw-2rem))] bg-[#2b2d31] border-[#3f4147] text-[#dbdee1] relative z-10 shadow-2xl">
        <CardHeader className="items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#5865f2] flex items-center justify-center mb-2">
            <Headphones className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">Mumble Web</CardTitle>
          <CardDescription className="text-[#b5bac1]">
            {inviteMode
              ? "你正通过邀请链接加入，服务器由邀请方指定"
              : "连接到你的 Mumble 语音服务器"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!username.trim() || (!inviteMode && portInvalid)) return;
              if (inviteMode) connect(username.trim(), "", "", inviteToken);
              else connect(username.trim(), password, serverAddr);
            }}
          >
            {!inviteMode && (
            <div className="space-y-2">
              <Label htmlFor="server" className="text-xs font-bold uppercase text-[#b5bac1]">
                服务器地址 / 端口
              </Label>
              <div className="flex gap-2">
                <Input
                  id="server"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={defaultAddr ? splitHostPort(defaultAddr).host : "代理默认服务器"}
                  className="flex-1 bg-[#1e1f22] border-none text-[#dbdee1] placeholder:text-[#6d6f78] focus-visible:ring-[#5865f2]"
                />
                <Input
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="64738"
                  inputMode="numeric"
                  className={`w-24 bg-[#1e1f22] border-none text-[#dbdee1] placeholder:text-[#6d6f78] focus-visible:ring-[#5865f2] ${
                    portInvalid ? "ring-1 ring-[#fa777c]" : ""
                  }`}
                />
              </div>
              <p className="text-[11px] text-[#6d6f78]">
                {portInvalid
                  ? "端口需为 1-65535 的数字"
                  : "留空则使用代理部署时配置的默认服务器"}
              </p>
            </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs font-bold uppercase text-[#b5bac1]">
                用户名 <span className="text-[#fa777c]">*</span>
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="你的昵称"
                autoFocus
                className="bg-[#1e1f22] border-none text-[#dbdee1] placeholder:text-[#6d6f78] focus-visible:ring-[#5865f2]"
              />
            </div>
            {!inviteMode && (
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold uppercase text-[#b5bac1]">
                服务器密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="如服务器设有密码请填写"
                className="bg-[#1e1f22] border-none text-[#dbdee1] placeholder:text-[#6d6f78] focus-visible:ring-[#5865f2]"
              />
            </div>
            )}

            {error && (
              <div className="rounded-md bg-[#fa777c]/10 border border-[#fa777c]/30 px-3 py-2 text-sm text-[#fa777c]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!username.trim() || connecting || portInvalid}
              className="w-full bg-[#5865f2] hover:bg-[#4752c4] text-white font-medium"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  连接中…
                </>
              ) : (
                "连 接"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
