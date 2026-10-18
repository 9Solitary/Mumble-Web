import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportJSON,
  getEvents,
  isReportEnabled,
  logEvent,
  resetDiagnosticsForTest,
  setSession,
} from "./diagnostics";

describe("diagnostics", () => {
  beforeEach(() => {
    resetDiagnosticsForTest();
    // 屏蔽本地 .env 中可能存在的 VITE_DIAG_ENABLED，确保「默认关闭」可测
    vi.stubEnv("VITE_DIAG_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("环形缓冲容量上限 500 条", () => {
    for (let i = 0; i < 600; i++) logEvent("test", { i });
    const events = getEvents();
    expect(events).toHaveLength(500);
    // 保留最近的事件：最早一条应为 i=100
    expect(events[0].data.i).toBe(100);
    expect(events[499].data.i).toBe(599);
  });

  it("隐私过滤：密码 / token / invite / sdp 等敏感键被剔除", () => {
    logEvent("error", {
      message: "连接失败",
      password: "secret-pw",
      inviteToken: "tok-123",
      access_token: "tok-456",
      sdp: "v=0 o=...",
      candidate: "candidate:1 udp ...",
      username: "alice",
    });
    const data = getEvents()[0].data;
    expect(data.message).toBe("连接失败");
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("inviteToken");
    expect(data).not.toHaveProperty("access_token");
    expect(data).not.toHaveProperty("sdp");
    expect(data).not.toHaveProperty("candidate");
    expect(data).not.toHaveProperty("username");
  });

  it("字符串字段截断到 200 字符，对象字段被忽略", () => {
    logEvent("error", { message: "x".repeat(300), detail: { nested: 1 } });
    const data = getEvents()[0].data;
    expect((data.message as string).length).toBe(200);
    expect(data).not.toHaveProperty("detail");
  });

  it("远端上报默认关闭", () => {
    expect(isReportEnabled()).toBe(false);
  });

  it("VITE_DIAG_ENABLED === '1' 时开启上报", () => {
    vi.stubEnv("VITE_DIAG_ENABLED", "1");
    expect(isReportEnabled()).toBe(true);
  });

  it("exportJSON 包含 sid / version / events", () => {
    setSession("0123456789abcdef", "dev");
    logEvent("ws-close", { code: 1000, wasClean: true });
    const parsed = JSON.parse(exportJSON());
    expect(parsed.sid).toBe("0123456789abcdef");
    expect(parsed.version).toBe("dev");
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].kind).toBe("ws-close");
  });
});
