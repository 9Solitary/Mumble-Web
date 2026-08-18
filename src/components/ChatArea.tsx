import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "./UserAvatar";
import { Volume2, SendHorizonal } from "lucide-react";
import type { TextMessageInfo } from "@/lib/protocol";

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Mumble 消息允许 HTML，网页端按纯文本安全展示（去除标签）
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}

function MessageRow({ msg }: { msg: TextMessageInfo }) {
  const isServer = msg.sender === 0;
  return (
    <div className="flex gap-3 px-4 py-1.5 hover:bg-[#2e3035] group">
      {isServer ? (
        <div className="w-9 h-9 rounded-full bg-[#5865f2]/20 flex items-center justify-center shrink-0">
          <Volume2 className="w-4 h-4 text-[#5865f2]" />
        </div>
      ) : (
        <UserAvatar name={msg.senderName || "?"} size={36} />
      )}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-sm font-medium ${isServer ? "text-[#5865f2]" : "text-white"}`}>
            {isServer ? "服务器" : msg.senderName || "未知用户"}
          </span>
          <span className="text-[11px] text-[#6d6f78]">{formatTime(msg.time)}</span>
        </div>
        <p className="text-sm text-[#dbdee1] break-words whitespace-pre-wrap leading-relaxed">
          {stripHtml(msg.message)}
        </p>
      </div>
    </div>
  );
}

export function ChatArea() {
  const { channels, currentChannelId, messages, sendText, self } = useAppStore();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const channel = channels[currentChannelId];
  const channelMessages = messages[currentChannelId] ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages.length, currentChannelId]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    sendText(currentChannelId, text);
    setDraft("");
  };

  return (
    <div className="flex-1 flex flex-col bg-[#313338] min-w-0">
      {/* 频道标题栏 */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#232428] shadow-sm shrink-0">
        <Volume2 className="w-5 h-5 text-[#949ba4]" />
        <span className="font-bold text-white text-sm">
          {channel?.name ?? "…"}
        </span>
        {channel?.description && (
          <>
            <div className="w-px h-5 bg-[#3f4147] mx-1" />
            <span className="text-xs text-[#949ba4] truncate">{channel.description}</span>
          </>
        )}
      </div>

      {/* 消息流 */}
      <ScrollArea className="flex-1">
        <div className="py-4">
          {channelMessages.length === 0 && (
            <div className="px-4 py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-[#41434a] flex items-center justify-center mx-auto mb-3">
                <Volume2 className="w-8 h-8 text-[#b5bac1]" />
              </div>
              <p className="text-white font-bold text-lg">
                欢迎来到 {channel?.name ?? "频道"}
              </p>
              <p className="text-[#949ba4] text-sm mt-1">
                这里还没有消息，来说点什么吧。当前在线身份：{self?.name}
              </p>
            </div>
          )}
          {channelMessages.map((m, i) => (
            <MessageRow key={`${m.time}-${i}`} msg={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="px-4 pb-5 pt-1 shrink-0">
        <div className="flex items-center gap-2 bg-[#383a40] rounded-lg px-4">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`发消息到 ${channel?.name ?? ""}`}
            className="flex-1 bg-transparent py-2.5 text-sm text-[#dbdee1] placeholder:text-[#6d6f78] outline-none"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="text-[#b5bac1] hover:text-white disabled:opacity-30 transition-colors"
          >
            <SendHorizonal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
