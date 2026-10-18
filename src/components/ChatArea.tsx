import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAppStore } from "@/store/appStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "./UserAvatar";
import { Volume2, SendHorizonal, ImagePlus, Loader2 } from "lucide-react";
import { imageToMessageDataUrl } from "@/lib/image";
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

// 提取消息中内嵌的 data: 图片（Mumble 图片消息就是 <img src="data:..."/>）
function renderMessage(message: string): ReactNode[] {
  const imgRe = /<img[^>]*?src=["'](data:image\/[a-z0-9.+-]+;base64,[^"']+)["'][^>]*?\/?>/gi;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(message))) {
    if (m.index > last)
      parts.push(<span key={parts.length}>{stripHtml(message.slice(last, m.index))}</span>);
    parts.push(
      <img
        key={parts.length}
        src={m[1]}
        alt="图片"
        className="mt-1 max-w-sm max-h-64 rounded border border-[#1e1f22]"
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < message.length)
    parts.push(<span key={parts.length}>{stripHtml(message.slice(last))}</span>);
  return parts;
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
          <span className={`text-sm font-medium truncate ${isServer ? "text-[#5865f2]" : "text-white"}`}>
            {isServer ? "服务器" : msg.senderName || "未知用户"}
          </span>
          <span className="text-[11px] text-[#6d6f78] shrink-0">{formatTime(msg.time)}</span>
        </div>
        <div className="text-sm text-[#dbdee1] break-words whitespace-pre-wrap leading-relaxed">
          {renderMessage(msg.message)}
        </div>
      </div>
    </div>
  );
}

export function ChatArea() {
  const { channels, currentChannelId, messages, sendText, self, maxImageMessageLength, connState } =
    useAppStore();
  const reconnecting = connState === "reconnecting";
  const [draft, setDraft] = useState("");
  const [sendingImage, setSendingImage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channel = channels[currentChannelId];
  const channelMessages = messages[currentChannelId] ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [channelMessages.length, currentChannelId]);

  const submit = () => {
    if (reconnecting) return; // 重连期间消息发不出去，禁止提交
    const text = draft.trim();
    if (!text) return;
    sendText(currentChannelId, text);
    setDraft("");
  };

  // 图片以 <img src="data:..."/> 内嵌在 HTML 消息中发送（与 Mumble 客户端一致），
  // 先压缩到服务器消息长度限制以内；输入框里已有的文字会一起发出。
  const sendImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setSendingImage(true);
    try {
      const text = draft.trim();
      // 预算 = 图片消息长度上限 - 标签/换行开销 - 已有文字长度
      const budget = Math.max(500, maxImageMessageLength - 64 - text.length);
      const dataUrl = await imageToMessageDataUrl(file, budget);
      const parts: string[] = [];
      if (text) {
        parts.push(
          text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        );
      }
      parts.push(`<img src="${dataUrl}"/>`);
      sendText(currentChannelId, parts.join("<br/>"));
      setDraft("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "图片发送失败");
    } finally {
      setSendingImage(false);
    }
  };

  const pickImage = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) {
      e.preventDefault();
      void sendImage(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#313338] min-w-0 min-h-0">
      {/* 频道标题栏 */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#232428] shadow-sm shrink-0 min-w-0">
        <Volume2 className="w-5 h-5 text-[#949ba4] shrink-0" />
        <span className="font-bold text-white text-sm truncate">
          {channel?.name ?? "…"}
        </span>
        {channel?.description && (
          <>
            <div className="w-px h-5 bg-[#3f4147] mx-1 shrink-0" />
            <span className="text-xs text-[#949ba4] truncate min-w-0">{channel.description}</span>
          </>
        )}
      </div>

      {/* 消息流 */}
      <ScrollArea className="flex-1 min-h-0">
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
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendImage(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingImage}
            title="发送图片（也可以直接粘贴）"
            className="text-[#b5bac1] hover:text-white disabled:opacity-30 transition-colors"
          >
            {sendingImage ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ImagePlus className="w-5 h-5" />
            )}
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={pickImage}
            disabled={reconnecting}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              reconnecting
                ? "连接已断开，正在重连…"
                : `发消息到 ${channel?.name ?? ""}（可粘贴图片）`
            }
            className="flex-1 bg-transparent py-2.5 text-sm text-[#dbdee1] placeholder:text-[#6d6f78] outline-none disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || reconnecting}
            className="text-[#b5bac1] hover:text-white disabled:opacity-30 transition-colors"
          >
            <SendHorizonal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
