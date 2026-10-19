import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "./UserAvatar";
import { ImageLightbox } from "./ImageLightbox";
import { Volume2, SendHorizonal, ImagePlus, Loader2 } from "lucide-react";
import { imageToMessageDataUrl } from "@/lib/image";
import { imageErrorKey } from "@/lib/errorMessages";
import type { TextMessageInfo } from "@/lib/protocol";

function formatTime(ts: number, locale: string): string {
  const d = new Date(ts * 1000);
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
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

const IMG_RE = /<img[^>]*?src=["'](data:image\/[a-z0-9.+-]+;base64,[^"']+)["'][^>]*?\/?>/gi;

// 提取消息中内嵌的 data: 图片（Mumble 图片消息就是 <img src="data:..."/>）
function extractImages(message: string): string[] {
  const images: string[] = [];
  IMG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(message))) images.push(m[1]);
  return images;
}

function renderMessage(
  message: string,
  onOpenImage: (index: number) => void,
  viewImageLabel: string,
  imageAlt: string,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let index = 0;
  IMG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(message))) {
    if (m.index > last)
      parts.push(<span key={parts.length}>{stripHtml(message.slice(last, m.index))}</span>);
    const current = index++;
    parts.push(
      <button
        key={parts.length}
        type="button"
        onClick={() => onOpenImage(current)}
        className="group relative mt-1 block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-line-strong bg-ink-900 text-left"
        aria-label={viewImageLabel}
      >
        <img
          src={m[1]}
          alt={imageAlt}
          className="block max-h-64 max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-overlay/70 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-fg/80 opacity-0 transition-opacity group-hover:opacity-100">
          {viewImageLabel}
        </span>
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < message.length)
    parts.push(<span key={parts.length}>{stripHtml(message.slice(last))}</span>);
  return parts;
}

function MessageRow({
  msg,
  onOpenImage,
}: {
  msg: TextMessageInfo;
  onOpenImage: (images: string[], index: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const isServer = msg.sender === 0;
  const images = useMemo(() => extractImages(msg.message), [msg.message]);

  return (
    <div className="group flex min-w-0 gap-3 rounded-lg px-2 py-1.5 hover:bg-fg/[0.022]">
      {isServer ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-mint/10">
          <Volume2 className="h-4 w-4 text-mint" />
        </div>
      ) : (
        <UserAvatar name={msg.senderName || "?"} size={36} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={`truncate text-ui font-semibold ${
              isServer ? "text-mint" : "text-fg"
            }`}
          >
            {isServer ? t("chat.serverSender") : msg.senderName || t("chat.unknownUser")}
          </span>
          <span className="shrink-0 font-mono text-data text-fg-subtle">
            {formatTime(msg.time, i18n.language)}
          </span>
        </div>
        <div className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-body text-fg [overflow-wrap:anywhere]">
          {renderMessage(
            msg.message,
            (index) => onOpenImage(images, index),
            t("chat.viewImage"),
            t("chat.imageAlt"),
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatArea() {
  const { t } = useTranslation();
  const {
    channels,
    currentChannelId,
    messages,
    sendText,
    self,
    maxMessageLength,
    maxImageMessageLength,
    connState,
  } = useAppStore();
  const reconnecting = connState === "reconnecting";
  const [draft, setDraft] = useState("");
  const [sendingImage, setSendingImage] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channel = channels[currentChannelId];
  const channelMessages = messages[currentChannelId] ?? [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channelMessages.length, currentChannelId]);

  // 输入框自动增高：1 行起步，最多 6 行左右；超过后内部滚动。
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const maxHeight = Number.parseFloat(getComputedStyle(el).maxHeight) || 140;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  const nearLimit = draft.length >= maxMessageLength * 0.8;

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
      const key =
        imageErrorKey(err instanceof Error ? err.message : "") ??
        "chat.imageSendFailed";
      alert(t(key));
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
    <div data-testid="chat-area" className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink-850">
      {/* 频道标题栏 */}
      <div data-testid="chat-header" className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <Volume2 className="h-5 w-5 shrink-0 text-fg-subtle" />
        <span className="truncate text-sm font-semibold text-fg">
          {channel?.name ?? "…"}
        </span>
        {channel?.description && (
          <>
            <div className="mx-1 h-5 w-px shrink-0 bg-fg/10" />
            <span className="min-w-0 truncate text-xs text-fg-subtle">
              {channel.description}
            </span>
          </>
        )}
      </div>

      {/* 消息流：原生滚动，避免 Radix ScrollArea 的 display:table 把长文本撑出框 */}
      <div
        ref={scrollRef}
        data-testid="messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[860px] px-3 py-4">
          {channelMessages.length === 0 && (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-fg/[0.04]">
                <Volume2 className="h-8 w-8 text-fg-subtle" />
              </div>
              <p className="text-title font-semibold text-fg">
                {t("chat.emptyTitle", { channel: channel?.name ?? "…" })}
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                {t("chat.emptyBody", { name: self?.name ?? "?" })}
              </p>
            </div>
          )}

          {channelMessages.length > 0 && (
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-data font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                {t("chat.today")}
              </span>
              <span className="h-px flex-1 bg-line" />
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {channelMessages.map((m, i) => (
              <MessageRow
                key={`${m.time}-${i}`}
                msg={m}
                onOpenImage={(images, index) => setLightbox({ images, index })}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 输入区：自动增高的多行输入，6 行后内部滚动 */}
      <div className="shrink-0 px-3 pb-4 pt-1">
        <div className="mx-auto flex max-w-[860px] items-end gap-2 rounded-panel border border-line-strong bg-ink-800 px-3 focus-within:border-mint/40 focus-within:ring-[3px] focus-within:ring-mint/10">
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
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingImage}
            data-testid="composer-image"
            title={t("chat.sendImage")}
            aria-label={t("chat.sendImage")}
            className="mb-1.5 text-fg-subtle transition-colors hover:text-fg disabled:opacity-30"
          >
            {sendingImage ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" />
            )}
          </button>
          <textarea
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={pickImage}
            disabled={reconnecting}
            maxLength={maxMessageLength}
            data-testid="composer-input"
            aria-label={
              reconnecting
                ? t("chat.placeholderReconnecting")
                : t("chat.placeholder", { channel: channel?.name ?? "" })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              reconnecting
                ? t("chat.placeholderReconnecting")
                : t("chat.placeholder", { channel: channel?.name ?? "" })
            }
            className="max-h-[140px] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-ui leading-5 text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || reconnecting}
            data-testid="composer-send"
            aria-label={t("chat.send")}
            className="mb-1.5 grid size-8 shrink-0 place-items-center rounded-lg bg-mint text-on-mint transition-colors hover:bg-mint-strong disabled:bg-transparent disabled:text-fg-subtle"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
        {nearLimit && (
          <div className="mx-auto mt-1 flex max-w-[860px] justify-end px-1 font-mono text-data text-fg-subtle">
            {t("chat.charCount", { count: draft.length, max: maxMessageLength })}
          </div>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndexChange={(index) =>
            setLightbox((current) => (current ? { ...current, index } : current))
          }
        />
      )}
    </div>
  );
}
