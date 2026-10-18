import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./appStore";
import type { Envelope } from "@/lib/protocol";

// appStore 重连状态机单测：mock WebSocket 模拟代理行为。
// store 是模块级单例，用例间用 disconnect()（主动断开）复位。

class MockWS {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWS[] = [];

  url: string;
  readyState = MockWS.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
    // 模拟浏览器异步触发 onopen
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWS.CLOSED;
    this.onclose?.({ code: 1000, reason: "", wasClean: true });
  }
  // 测试辅助：服务端下发信封 / 异常断开
  deliver(env: Envelope) {
    this.onmessage?.({ data: JSON.stringify(env) });
  }
  drop(code = 1006) {
    this.readyState = MockWS.CLOSED;
    this.onclose?.({ code, reason: "", wasClean: false });
  }
  lastSent(): Envelope {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

const HELLO: Envelope = {
  type: "hello",
  sid: "test-sid",
  version: "test",
  server: { address: "mock:64738", resolved: "127.0.0.1:64738", tlsMode: "insecure", voice: "webrtc" },
};
const CONNECTED: Envelope = {
  type: "connected",
  self: { session: 1, name: "alice", channelId: 0 },
};
const SYNCED: Envelope = { type: "synced" };

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

// 登录到 ready（hello → connected → synced），返回当前 WS
async function login(ws: MockWS) {
  await flush(); // 等 onopen 发出 connect
  ws.deliver(HELLO);
  ws.deliver(CONNECTED);
  ws.deliver(SYNCED);
  await flush();
}

describe("appStore 重连状态机", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWS);
    MockWS.instances = [];
    // 复位单例 store（主动断开路径同时清理重连闭包状态）
    useAppStore.getState().disconnect();
  });

  afterEach(() => {
    useAppStore.getState().disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("异常断开 → reconnecting → 重发 connect（带密码）→ connected/ready", async () => {
    useAppStore.getState().connect("alice", "pw123", "mock:64738");
    const ws1 = MockWS.instances[0];
    await login(ws1);
    expect(useAppStore.getState().connState).toBe("ready");
    expect(ws1.lastSent()).toMatchObject({ type: "connect", username: "alice", password: "pw123" });

    // 1006 异常断开 → 进入重连
    ws1.drop(1006);
    const s1 = useAppStore.getState();
    expect(s1.connState).toBe("reconnecting");
    expect(s1.reconnectAttempt).toBe(1);

    // 退避后发起新 WS，重发 connect（普通用户用已保存凭据）
    await vi.advanceTimersByTimeAsync(2000);
    expect(MockWS.instances).toHaveLength(2);
    const ws2 = MockWS.instances[1];
    await flush(); // onopen
    const env = ws2.lastSent();
    expect(env).toMatchObject({ type: "connect", username: "alice", password: "pw123" });
    expect(env.resumeToken).toBeUndefined();

    // 重连成功 → 状态恢复，计数器累计
    ws2.deliver(HELLO);
    ws2.deliver(CONNECTED);
    ws2.deliver(SYNCED);
    await flush();
    const s2 = useAppStore.getState();
    expect(s2.connState).toBe("ready");
    expect(s2.reconnectAttempt).toBe(0);
    expect(s2.reconnectCount).toBe(1);
  });

  it("主动断开 → 不重连", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);

    useAppStore.getState().disconnect(); // dispose 会 close WS 触发 onclose
    expect(useAppStore.getState().connState).toBe("idle");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(1); // 没有新建 WS
    expect(useAppStore.getState().connState).toBe("idle");
  });

  it("连续失败 10 次 → failed", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);

    MockWS.instances[0].drop(1006); // 首次断开 → attempt 1
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(40_000); // 越过最大退避（30s+抖动）
      MockWS.instances[MockWS.instances.length - 1].drop(1006);
    }
    const s = useAppStore.getState();
    expect(s.connState).toBe("failed");
    expect(s.error).toContain("自动重连失败");
    expect(MockWS.instances).toHaveLength(11); // 首次连接 + 10 次重试
  });

  it("邀请用户：保存 resume_token，重连用 resumeToken（与 password/inviteToken 互斥）", async () => {
    useAppStore.getState().connect("bob", "", "", "inv-tok");
    const ws1 = MockWS.instances[0];
    await flush();
    expect(ws1.lastSent()).toMatchObject({ type: "connect", username: "bob", inviteToken: "inv-tok" });

    ws1.deliver(HELLO);
    ws1.deliver({ type: "connected", self: { session: 7, name: "bob", channelId: 0 } });
    ws1.deliver({ type: "resume_token", token: "resume-hex", expiresAt: 9999999999 });
    ws1.deliver(SYNCED);
    await flush();
    expect(useAppStore.getState().connState).toBe("ready");

    ws1.drop(1011); // 契约 4：上游断开以 1011 关闭
    expect(useAppStore.getState().connState).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2000);
    const ws2 = MockWS.instances[1];
    await flush();
    const env = ws2.lastSent();
    expect(env).toMatchObject({ type: "connect", username: "bob", resumeToken: "resume-hex" });
    expect(env.password).toBeUndefined();
    expect(env.inviteToken).toBeUndefined();
  });

  it("服务端 disconnected 信封不直接置 failed（等 1011 关闭驱动重连）", async () => {    useAppStore.getState().connect("alice", "pw123");
    const ws1 = MockWS.instances[0];
    await login(ws1);

    ws1.deliver({ type: "disconnected", reason: "上游 Mumble 断开" });
    expect(useAppStore.getState().connState).toBe("ready"); // 尚未置 failed
    expect(useAppStore.getState().error).toBe("上游 Mumble 断开");

    ws1.drop(1011);
    expect(useAppStore.getState().connState).toBe("reconnecting");
  });

  it("低延迟接收缓冲：默认开启，切换后持久化到 localStorage", () => {
    expect(useAppStore.getState().lowLatencyBuffer).toBe(true);
    useAppStore.getState().setLowLatencyBuffer(false);
    expect(useAppStore.getState().lowLatencyBuffer).toBe(false);
    const saved = JSON.parse(localStorage.getItem("mumble-web.settings") ?? "{}");
    expect(saved.lowLatencyBuffer).toBe(false);
    useAppStore.getState().setLowLatencyBuffer(true); // 还原默认值
  });
});
