import { describe, expect, it } from "vitest";
import {
  extractImages,
  groupMessages,
  localDayKey,
  splitLinks,
  stripHtml,
} from "./chat";
import type { TextMessageInfo } from "./protocol";

function message(
  time: number,
  sender: number,
  text: string,
  senderName = sender === 0 ? "服务器" : `用户 ${sender}`,
): TextMessageInfo {
  return { sender, senderName, channelIds: [0], message: text, time };
}

const DAY = 86_400;

describe("stripHtml", () => {
  it("去标签、保留换行并解码常见实体", () => {
    expect(
      stripHtml("第一行<br/>第二行 <b>加粗</b> &lt;tag&gt; &amp; &quot;q&quot;"),
    ).toBe('第一行\n第二行 加粗 <tag> & "q"');
  });
});

describe("extractImages", () => {
  it("按出现顺序提取 data URL，忽略普通图片", () => {
    const message = [
      '<img src="data:image/png;base64,AAA"/>',
      '<img src="https://example.com/a.png"/>',
      '<img src="data:image/jpeg;base64,BBB">',
    ].join("");
    expect(extractImages(message)).toEqual([
      "data:image/png;base64,AAA",
      "data:image/jpeg;base64,BBB",
    ]);
  });
});

describe("splitLinks", () => {
  it("识别句首、句中、句尾链接并剥离中文标点", () => {
    expect(splitLinks("看 https://example.com/a?b=1，然后 https://example.com/b。")).toEqual([
      { type: "text", value: "看 " },
      { type: "link", value: "https://example.com/a?b=1" },
      { type: "text", value: "，然后 " },
      { type: "link", value: "https://example.com/b" },
      { type: "text", value: "。" },
    ]);
  });

  it("保留配对的括号，去掉句尾多余的右括号", () => {
    expect(splitLinks("(https://example.com/a_(b))")).toEqual([
      { type: "text", value: "(" },
      { type: "link", value: "https://example.com/a_(b)" },
      { type: "text", value: ")" },
    ]);
    expect(splitLinks("https://example.com/a)")).toEqual([
      { type: "link", value: "https://example.com/a" },
      { type: "text", value: ")" },
    ]);
  });

  it("没有链接时返回单个文本段", () => {
    expect(splitLinks("普通消息")).toEqual([
      { type: "text", value: "普通消息" },
    ]);
    expect(splitLinks("")).toEqual([]);
  });
});

describe("groupMessages", () => {
  const base = new Date(2026, 9, 19, 12, 0, 0).getTime() / 1000;

  it("同一发送者 5 分钟内合并，换人或超时重新分组", () => {
    const sections = groupMessages([
      message(base, 1, "a"),
      message(base + 60, 1, "b"),
      message(base + 400, 1, "c"),
      message(base + 420, 2, "d"),
    ]);

    const groups = sections.filter((section) => section.kind === "group");
    expect(groups).toHaveLength(3);
    expect(groups[0].messages.map((m) => m.message)).toEqual(["a", "b"]);
    expect(groups[1].messages.map((m) => m.message)).toEqual(["c"]);
    expect(groups[2].messages.map((m) => m.message)).toEqual(["d"]);
  });

  it("跨日插入日期分隔并断开分组", () => {
    const sections = groupMessages([
      message(base, 1, "今天"),
      message(base - DAY, 1, "昨天"),
    ]);

    expect(sections.map((section) => section.kind)).toEqual([
      "day",
      "group",
      "day",
      "group",
    ]);
    expect(localDayKey(base)).not.toBe(localDayKey(base - DAY));
  });

  it("系统消息单独成行，并打断后续分组", () => {
    const sections = groupMessages([
      message(base, 1, "a"),
      message(base + 10, 0, "服务器提示"),
      message(base + 20, 1, "b"),
    ]);

    expect(sections.map((section) => section.kind)).toEqual([
      "day",
      "group",
      "system",
      "group",
    ]);
  });

  it("时间倒序的消息不会被错误合并", () => {
    const sections = groupMessages([
      message(base, 1, "a"),
      message(base - 10, 1, "b"),
    ]);
    const groups = sections.filter((section) => section.kind === "group");
    expect(groups).toHaveLength(2);
  });
});
