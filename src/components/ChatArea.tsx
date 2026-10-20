import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/appStore";
import { UserAvatar } from "./UserAvatar";
import { ImageLightbox } from "./ImageLightbox";
import {
  Check,
  Copy,
  ImagePlus,
  Loader2,
  SendHorizonal,
  Users,
  Volume2,
} from "lucide-react";
import { imageToMessageDataUrl } from "@/lib/image";
import { imageErrorKey } from "@/lib/errorMessages";
import {
  groupMessages,
  splitLinks,
  splitMessage,
  stripHtml,
} from "@/lib/chat";
import { cn } from "@/lib/utils";
import type { TextMessageInfo } from "@/lib/protocol";

const EMPTY_MESSAGES: TextMessageInfo[] = [];

function formatTime(ts: number, locale: string): string {
  const date = new Date(ts * 1000);
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(
  timestamp: number,
  locale: string,
  today: string,
  yesterday: string,
): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  if (sameLocalDay(date, now)) return today;
  const previous = new Date(now);
  previous.setDate(now.getDate() - 1);
  if (sameLocalDay(date, previous)) return yesterday;

  const options: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
  };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
}

function renderText(text: string): ReactNode[] {
  return splitLinks(text).map((segment, index) => {
    if (segment.type === "link") {
      return (
        <a
          key={index}
          href={segment.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-mint underline decoration-mint/35 underline-offset-2 transition-colors hover:decoration-mint [overflow-wrap:anywhere]"
        >
          {segment.value}
        </a>
      );
    }
    return <span key={index}>{segment.value}</span>;
  });
}

function renderMessage(
  message: string,
  onOpenImage: (index: number, trigger: HTMLButtonElement) => void,
  viewImageLabel: string,
  imageAlt: string,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let imageIndex = 0;

  for (const part of splitMessage(message)) {
    if (part.type === "image") {
      const current = imageIndex++;
      parts.push(
        <button
          key={parts.length}
          type="button"
          onClick={(event) => onOpenImage(current, event.currentTarget)}
          data-testid="message-image"
          className="group/image relative mt-1.5 block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-line-strong bg-ink-900 text-left"
          aria-label={viewImageLabel}
        >
          <img
            src={part.value}
            alt={imageAlt}
            className="block max-h-64 max-w-full object-contain transition-transform duration-200 group-hover/image:scale-[1.01]"
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-overlay/70 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-fg/80 opacity-0 transition-opacity group-hover/image:opacity-100">
            {viewImageLabel}
          </span>
        </button>,
      );
      continue;
    }

    const text = stripHtml(part.value);
    if (!text) continue;
    parts.push(
      <Fragment key={parts.length}>{renderText(text)}</Fragment>,
    );
  }

  return parts;
}

function DayDivider({ timestamp }: { timestamp: number }) {
  const { t, i18n } = useTranslation();
  const label = dayLabel(
    timestamp,
    i18n.language,
    t("chat.today"),
    t("chat.yesterday"),
  );

  return (
    <div
      data-testid="date-divider"
      className="my-3 flex items-center gap-3"
    >
      <span className="h-px flex-1 bg-line" />
      <span className="text-data font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        {label}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function SystemMessage({ message }: { message: TextMessageInfo }) {
  const text = stripHtml(message.message).trim();
  if (!text) return null;

  return (
    <div data-testid="system-message" className="my-2 flex justify-center px-2">
      <span className="max-w-[86%] rounded-full border border-line bg-ink-800/55 px-3 py-1 text-center text-caption leading-relaxed text-fg-subtle [overflow-wrap:anywhere]">
        {renderText(text)}
      </span>
    </div>
  );
}

function MessageRow({
  msg,
  showMeta,
  onOpenImage,
}: {
  msg: TextMessageInfo;
  showMeta: boolean;
  onOpenImage: (
    images: string[],
    index: number,
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const copyText = useMemo(() => stripHtml(msg.message).trim(), [msg.message]);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时保持原图标 */
    }
  };

  return (
    <div
      data-testid="message-row"
      className={cn(
        "group/message relative flex min-w-0 gap-3 rounded-lg px-2 transition-colors hover:bg-fg/[0.022]",
        showMeta ? "pb-1 pt-1.5" : "py-0.5",
      )}
    >
      {showMeta ? (
        <UserAvatar
          name={msg.senderName || t("chat.unknownUser")}
          size={36}
        />
      ) : (
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1">
        {showMeta && (
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              data-testid="message-author"
              className="truncate text-ui font-semibold text-fg"
            >
              {msg.senderName || t("chat.unknownUser")}
            </span>
            <span className="shrink-0 font-mono text-data text-fg-subtle">
              {formatTime(msg.time, i18n.language)}
            </span>
          </div>
        )}
        <div
          className={cn(
            "min-w-0 whitespace-pre-wrap break-words text-body text-fg [overflow-wrap:anywhere]",
            showMeta ? "mt-0.5" : "leading-[1.65]",
          )}
        >
          {renderMessage(
            msg.message,
            (index, trigger) =>
              onOpenImage(extractMessageImages(msg.message), index, trigger),
            t("chat.viewImage"),
            t("chat.imageAlt"),
          )}
        </div>
      </div>

      {copyText && (
        <div className="pointer-events-none absolute right-2 top-1 z-10 flex items-center rounded-md border border-line-strong bg-ink-800 p-0.5 opacity-0 shadow-panel transition-opacity duration-fast group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            data-testid="message-copy"
            aria-label={t("chat.copyMessage")}
            title={t("chat.copyMessage")}
            className="grid size-6 place-items-center rounded text-fg-subtle transition-colors hover:bg-ink-700 hover:text-fg"
          >
            {copied ? (
              <Check className="size-3.5 text-mint" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? t("common.copied") : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// 每个消息行的图片集合单独传给查看器，支持一条消息里多张图。
function extractMessageImages(message: string): string[] {
  return splitMessage(message)
    .filter((part) => part.type === "image")
    .map((part) => part.value);
}

export function ChatArea({
  channelId,
  onOpenMembers,
}: {
  channelId?: number;
  onOpenMembers?: () => void;
}) {
  const { t } = useTranslation();
  const {
    channels,
    currentChannelId,
    messages,
    sendText,
    self,
    users,
    maxMessageLength,
    maxImageMessageLength,
    connState,
    joinChannel,
  } = useAppStore();
  const reconnecting = connState === "reconnecting";
  const activeChannelId = channelId ?? currentChannelId;
  const canPost = activeChannelId === currentChannelId && !reconnecting;

  const [draft, setDraft] = useState("");
  const [sendingImage, setSendingImage] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channel = channels[activeChannelId];
  const channelMessages = messages[activeChannelId] ?? EMPTY_MESSAGES;
  const inViewedChannel = activeChannelId === currentChannelId;
  const memberCount = Object.keys(users).length;
  const sections = useMemo(() => groupMessages(channelMessages), [channelMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channelMessages.length, activeChannelId]);

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
  const placeholder = reconnecting
    ? t("chat.placeholderReconnecting")
    : !inViewedChannel
      ? t("chat.joinToTalk", { channel: channel?.name ?? "" })
      : t("chat.placeholder", { channel: channel?.name ?? "" });

  const submit = () => {
    if (!canPost) return; // 重连中或正在查看别的频道时不能发
    const text = draft.trim();
    if (!text) return;
    sendText(currentChannelId, text);
    setDraft("");
  };

  // 图片以 <img src="data:..."/> 内嵌在 HTML 消息中发送（与 Mumble 客户端一致），
  // 先压缩到服务器消息长度限制以内；输入框里已有的文字会一起发出。
  const sendImage = async (file: File) => {
    if (!canPost || !file.type.startsWith("image/")) return;
    setImageError("");
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
      setImageError(t(key));
    } finally {
      setSendingImage(false);
    }
  };

  const pickImage = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((candidate) =>
      candidate.type.startsWith("image/"),
    );
    if (file) {
      e.preventDefault();
      void sendImage(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDraggingImage(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDraggingImage(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggingImage(false);
    const file = Array.from(e.dataTransfer.files ?? []).find((candidate) =>
      candidate.type.startsWith("image/"),
    );
    if (file) void sendImage(file);
  };

  return (
    <main
      data-testid="chat-area"
      aria-label={t("chat.title")}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink-850"
    >
      {/* 频道标题栏 */}
      <div data-testid="chat-header" className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <Volume2 className="h-5 w-5 shrink-0 text-fg-subtle" />
        <span className="truncate text-sm font-semibold text-fg">
          {channel?.name ?? "…"}
        </span>
        {channel?.description && (
          <>
            <div className="mx-1 hidden h-5 w-px shrink-0 bg-fg/10 sm:block" />
            <span className="hidden min-w-0 truncate text-xs text-fg-subtle sm:inline">
              {channel.description}
            </span>
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!inViewedChannel && (
            <button
              type="button"
              onClick={() => joinChannel(activeChannelId)}
              disabled={reconnecting}
              data-testid="chat-join-channel"
              className="shrink-0 rounded-control border border-mint/30 bg-mint/10 px-2.5 py-1.5 text-caption font-medium text-mint transition-colors hover:bg-mint/15 disabled:opacity-50"
            >
              {t("chat.joinVoice")}
            </button>
          )}
          {onOpenMembers && (
            <button
              type="button"
              onClick={onOpenMembers}
              data-testid="chat-open-members"
              aria-label={t("member.openCount", { count: memberCount })}
              title={t("member.openCount", { count: memberCount })}
              className="flex h-8 shrink-0 items-center gap-1 rounded-control border border-line-strong px-2 text-caption text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg min-[1180px]:hidden"
            >
              <Users className="size-4" aria-hidden="true" />
              <span aria-hidden="true" className="font-mono text-data">{memberCount}</span>
            </button>
          )}
        </div>
      </div>

      {/* 消息流：原生滚动，避免 Radix ScrollArea 的 display:table 把长文本撑出框 */}
      <div
        ref={scrollRef}
        data-testid="messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[820px] px-3 py-4">
          {channelMessages.length === 0 && (
            <div role="status" className="px-4 py-10 text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-fg/[0.04]">
                <Volume2 className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
              </div>
              <p className="text-title font-semibold text-fg">
                {t("chat.emptyTitle", { channel: channel?.name ?? "…" })}
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                {inViewedChannel
                  ? t("chat.emptyBody", { name: self?.name ?? "?" })
                  : t("chat.emptyNotJoined", {
                      channel: channel?.name ?? "…",
                    })}
              </p>
              {!inViewedChannel && (
                <button
                  type="button"
                  onClick={() => joinChannel(activeChannelId)}
                  data-testid="chat-join-empty"
                  className="mt-4 rounded-control bg-mint px-4 py-2 text-ui font-semibold text-on-mint transition-colors hover:bg-mint-strong"
                >
                  {t("chat.joinVoice")}
                </button>
              )}
            </div>
          )}

          {channelMessages.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {sections.map((section) => {
                if (section.kind === "day") {
                  return (
                    <DayDivider
                      key={section.key}
                      timestamp={section.timestamp}
                    />
                  );
                }
                if (section.kind === "system") {
                  return (
                    <SystemMessage key={section.key} message={section.message} />
                  );
                }
                return (
                  <Fragment key={section.key}>
                    {section.messages.map((message, index) => (
                      <MessageRow
                        key={`${section.key}-${index}`}
                        msg={message}
                        showMeta={index === 0}
                        onOpenImage={(images, imageIndex, trigger) => {
                          lightboxTriggerRef.current = trigger;
                          setLightbox({ images, index: imageIndex });
                        }}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 输入区：自动增高的多行输入，6 行后内部滚动；支持粘贴/拖拽图片 */}
      <div className="shrink-0 px-3 pb-4 pt-1">
        <div
          data-testid="composer"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative mx-auto flex max-w-[820px] items-end gap-2 rounded-panel border border-line-strong bg-ink-800 px-3 transition-[border-color,box-shadow] focus-within:border-mint/40 focus-within:ring-[3px] focus-within:ring-mint/10",
            draggingImage && "border-mint/60 ring-[3px] ring-mint/15",
          )}
        >
          {draggingImage && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-panel bg-ink-900/85 text-caption font-medium text-mint">
              {t("chat.dropImage")}
            </div>
          )}
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
            disabled={sendingImage || !canPost}
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
            disabled={!canPost}
            maxLength={maxMessageLength}
            data-testid="composer-input"
            aria-label={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="max-h-[140px] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-ui leading-5 text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || !canPost}
            data-testid="composer-send"
            aria-label={t("chat.send")}
            className="mb-1.5 grid size-8 shrink-0 place-items-center rounded-lg bg-mint text-on-mint transition-colors hover:bg-mint-strong disabled:bg-transparent disabled:text-fg-subtle"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>

        <div
          className={cn(
            "mx-auto mt-1 flex max-w-[820px] items-center justify-between gap-2 px-1 text-data text-fg-subtle",
            nearLimit ? "" : "hidden sm:flex",
          )}
        >
          <span className="hidden min-w-0 truncate sm:inline">
            {t("chat.composerHint")}
          </span>
          {nearLimit && (
            <span className="ml-auto shrink-0 font-mono">
              {t("chat.charCount", { count: draft.length, max: maxMessageLength })}
            </span>
          )}
        </div>

        {imageError && (
          <p
            role="alert"
            className="mx-auto mt-1 max-w-[820px] px-1 text-caption text-danger"
          >
            {imageError}
          </p>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => {
            setLightbox(null);
            window.requestAnimationFrame(() => {
              lightboxTriggerRef.current?.focus();
            });
          }}
          onIndexChange={(index) =>
            setLightbox((current) => (current ? { ...current, index } : current))
          }
        />
      )}
    </main>
  );
}
