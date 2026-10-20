import type { TextMessageInfo } from "@/lib/protocol";

const IMG_RE = /<img[^>]*?src=["'](data:image\/[a-z0-9.+-]+;base64,[^"']+)["'][^>]*?\/?>/gi;
const LINK_RE =
  /\bhttps?:\/\/[^\s<>"'，。；：！？、（）【】《》“”‘’]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、]+$/;
const CLOSING_BRACKETS = /[)\]】》]/;

// Mumble 消息允许 HTML，网页端按纯文本安全展示（去标签，保留换行）。
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// 提取消息中内嵌的 data: 图片（Mumble 图片消息就是 <img src="data:..."/>）。
export function extractImages(message: string): string[] {
  const images: string[] = [];
  IMG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMG_RE.exec(message))) images.push(match[1]);
  return images;
}

export type TextSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string };

export type MessagePart =
  | { type: "text"; value: string }
  | { type: "image"; value: string };

// 把 Mumble HTML 消息拆成「文本 / data: 图片」片段，文本保留原始 HTML 供后续 stripHtml。
export function splitMessage(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  IMG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMG_RE.exec(message))) {
    if (match.index > last) {
      parts.push({ type: "text", value: message.slice(last, match.index) });
    }
    parts.push({ type: "image", value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < message.length) {
    parts.push({ type: "text", value: message.slice(last) });
  }
  return parts;
}

function trimLink(raw: string): string {
  let value = raw;
  value = value.replace(TRAILING_PUNCTUATION, "");
  // 句尾的 ) ] 等只有在没有对应左括号时才去掉，避免截断维基/文档链接。
  while (CLOSING_BRACKETS.test(value.slice(-1))) {
    const last = value.slice(-1);
    const open = last === ")" ? "(" : last === "]" ? "[" : last === "】" ? "【" : "《";
    const opens = value.split(open).length - 1;
    const closes = value.split(last).length - 1;
    if (closes <= opens) break;
    value = value.slice(0, -1);
    value = value.replace(TRAILING_PUNCTUATION, "");
  }
  return value;
}

// 把纯文本切成普通文本与 http(s) 链接，保留原始顺序和空白。
export function splitLinks(text: string): TextSegment[] {
  if (!text) return [];
  const segments: TextSegment[] = [];
  let last = 0;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(text))) {
    const url = trimLink(match[0]);
    if (!url) continue;
    if (match.index > last) {
      segments.push({ type: "text", value: text.slice(last, match.index) });
    }
    segments.push({ type: "link", value: url });
    last = match.index + url.length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }
  return segments;
}

export type ChatSection =
  | { kind: "day"; key: string; timestamp: number }
  | { kind: "system"; key: string; message: TextMessageInfo }
  | {
      kind: "group";
      key: string;
      sender: number;
      senderName: string;
      messages: TextMessageInfo[];
      startTime: number;
    };

export function localDayKey(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// 按发送者 5 分钟分组，并在日期变化处插入分隔；系统消息单独成行。
export function groupMessages(
  messages: TextMessageInfo[],
  windowSeconds = 300,
): ChatSection[] {
  const sections: ChatSection[] = [];
  let currentDay = "";
  let currentGroup: Extract<ChatSection, { kind: "group" }> | null = null;
  let lastTime = 0;

  messages.forEach((message, index) => {
    const day = localDayKey(message.time);
    if (day !== currentDay) {
      currentDay = day;
      currentGroup = null;
      sections.push({
        kind: "day",
        key: `day-${day}-${index}`,
        timestamp: message.time,
      });
    }

    if (message.sender === 0) {
      currentGroup = null;
      sections.push({
        kind: "system",
        key: `system-${message.time}-${index}`,
        message,
      });
      return;
    }

    const sameGroup =
      currentGroup != null &&
      currentGroup.sender === message.sender &&
      message.time >= lastTime &&
      message.time - lastTime <= windowSeconds;

    if (sameGroup && currentGroup) {
      currentGroup.messages.push(message);
      lastTime = message.time;
      return;
    }

    const group: Extract<ChatSection, { kind: "group" }> = {
      kind: "group",
      key: `group-${message.sender}-${message.time}-${index}`,
      sender: message.sender,
      senderName: message.senderName,
      messages: [message],
      startTime: message.time,
    };
    currentGroup = group;
    lastTime = message.time;
    sections.push(group);
  });

  return sections;
}
