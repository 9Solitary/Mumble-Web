import { useState } from "react";
import { useAppStore } from "@/store/appStore";
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
import { Headphones, Loader2, ShieldAlert, Server } from "lucide-react";

export function ConnectScreen() {
  const { connState, error, server, connect } = useAppStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const connecting = connState === "connecting" || connState === "connected";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#1e1f22] relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#5865f2]/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-[#23a55a]/15 blur-[120px]" />
      </div>

      <Card className="w-[400px] bg-[#2b2d31] border-[#3f4147] text-[#dbdee1] relative z-10 shadow-2xl">
        <CardHeader className="items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#5865f2] flex items-center justify-center mb-2">
            <Headphones className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">Mumble Web</CardTitle>
          <CardDescription className="text-[#b5bac1]">
            连接到你的 Mumble 语音服务器
          </CardDescription>
        </CardHeader>
        <CardContent>
          {server && (
            <div className="mb-4 rounded-md bg-[#1e1f22] p-3 text-xs text-[#949ba4] space-y-1">
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {server.address} → {server.resolved}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>
                  TLS: {server.tlsMode} · 语音通道: {server.voice}
                </span>
              </div>
            </div>
          )}

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (username.trim()) connect(username.trim(), password);
            }}
          >
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

            {error && (
              <div className="rounded-md bg-[#fa777c]/10 border border-[#fa777c]/30 px-3 py-2 text-sm text-[#fa777c]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={!username.trim() || connecting}
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
