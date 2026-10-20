import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./appStore";
import { CLIENT_ERROR_CODES } from "@/lib/errorMessages";
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
  inviteEnabled: true,
  server: { address: "mock:64738", resolved: "127.0.0.1:64738", tlsMode: "insecure", voice: "webrtc" },
};
const CONNECTED: Envelope = {
  type: "connected",
  self: { session: 1, name: "alice", channelId: 0 },
};
const SYNCED: Envelope = { type: "synced" };
const INVITE: Envelope = {
  type: "invite",
  token: "invite-token",
  url: "https://chat.example.com/invite/invite-token",
  expiresAt: 9_999_999_999,
};

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
    const firstClientId = ws1.lastSent().clientId;
    expect(firstClientId, "connect 应带标签页 clientId").toBeTruthy();

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
    expect(env.clientId).toBe(firstClientId);
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
    expect(s.error).toBe(CLIENT_ERROR_CODES.reconnectFailed);
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

  it("阈值 0 是自动门控：静音不亮、说话才亮", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);

    const client = useAppStore.getState().client;
    const level = vi.spyOn(client, "getMicLevel").mockReturnValue(0);
    client.onMicReady();
    await vi.advanceTimersByTimeAsync(200);
    expect(useAppStore.getState().vadThreshold).toBe(0);
    expect(useAppStore.getState().selfTalking).toBe(false);

    level.mockReturnValue(0.2);
    await vi.advanceTimersByTimeAsync(100);
    expect(useAppStore.getState().selfTalking).toBe(true);

    level.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(useAppStore.getState().selfTalking).toBe(false);
  });

  it("4001 关闭兜底：即使 disconnected 信封丢失也停在终止态", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws1 = MockWS.instances[0];
    await login(ws1);

    ws1.drop(4001);
    expect(useAppStore.getState().connState).toBe("ended");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(1);
  });

  it("被顶号：进入 ended，不再自动重连", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws1 = MockWS.instances[0];
    await login(ws1);

    ws1.deliver({
      type: "disconnected",
      reason: "another session signed in with this name",
      code: "session_takeover",
    });
    const state = useAppStore.getState();
    expect(state.connState).toBe("ended");
    expect(state.endCode).toBe("session_takeover");
    expect(state.selfTalking).toBe(false);

    // 关闭 WS 也不应再发起重连
    ws1.drop(4001);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(1);
    expect(useAppStore.getState().connState).toBe("ended");
  });

  it("重名被拒绝：进入 ended，不再自动重连", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws1 = MockWS.instances[0];
    await flush();
    ws1.deliver(HELLO);
    ws1.deliver({
      type: "reject",
      reason: "这个昵称已被占用",
      code: "username_in_use",
    });

    const state = useAppStore.getState();
    expect(state.connState).toBe("ended");
    expect(state.endCode).toBe("username_in_use");
    expect(state.endDetail).toContain("昵称已被占用");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(1);
    expect(useAppStore.getState().connState).toBe("ended");
  });

  it("被踢：进入 ended，不自动重连", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);

    MockWS.instances[0].deliver({
      type: "disconnected",
      reason: "kicked",
      code: "kicked",
    });
    expect(useAppStore.getState().connState).toBe("ended");
    expect(useAppStore.getState().endCode).toBe("kicked");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(1);
  });

  it("抖动保护：60s 内 3 次短连接后停止重连", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);

    for (let i = 0; i < 3; i++) {
      MockWS.instances[MockWS.instances.length - 1].drop(1006);
      if (i === 2) break;
      await vi.advanceTimersByTimeAsync(2000);
      const next = MockWS.instances[MockWS.instances.length - 1];
      await flush();
      next.deliver(HELLO);
      next.deliver(CONNECTED);
      next.deliver(SYNCED);
      await flush();
      expect(useAppStore.getState().connState).toBe("ready");
    }

    const state = useAppStore.getState();
    expect(state.connState).toBe("ended");
    expect(state.endCode).toBe("flap_guard");
    const count = MockWS.instances.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(MockWS.instances).toHaveLength(count);
  });

  it("终止页：重新进入复用凭据，换个昵称回到 idle", async () => {
    useAppStore.getState().connect("alice", "pw123");
    await login(MockWS.instances[0]);
    MockWS.instances[0].deliver({
      type: "disconnected",
      reason: "taken over",
      code: "session_takeover",
    });
    expect(useAppStore.getState().connState).toBe("ended");

    useAppStore.getState().retryAfterEnd();
    await flush();
    expect(useAppStore.getState().connState).toBe("connecting");
    expect(MockWS.instances).toHaveLength(2);
    expect(MockWS.instances[1].lastSent()).toMatchObject({
      type: "connect",
      username: "alice",
      password: "pw123",
    });

    // 再次进入 terminated，然后换昵称
    MockWS.instances[1].deliver({
      type: "disconnected",
      reason: "taken over",
      code: "session_takeover",
    });
    useAppStore.getState().returnToConnect();
    expect(useAppStore.getState().connState).toBe("idle");
    expect(useAppStore.getState().endCode).toBe("");
  });

  it("普通用户：createInvite 发送请求，成功后保存链接", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await login(ws);
    expect(useAppStore.getState().inviteEnabled).toBe(true);
    expect(useAppStore.getState().invited).toBe(false);

    useAppStore.getState().createInvite();
    expect(ws.lastSent()).toEqual({ type: "createInvite" });
    expect(useAppStore.getState().inviteStatus).toBe("loading");

    ws.deliver(INVITE);
    const state = useAppStore.getState();
    expect(state.inviteStatus).toBe("ready");
    expect(state.inviteLink).toEqual({
      token: "invite-token",
      url: "https://chat.example.com/invite/invite-token",
      expiresAt: 9_999_999_999,
      minutes: expect.any(Number),
    });
    expect(state.inviteError).toBe("");
  });

  it("受邀用户：本地直接拒绝，不发送 createInvite", async () => {
    useAppStore.getState().connect("bob", "", "", "inv-tok");
    const ws = MockWS.instances[0];
    await flush();
    ws.deliver(HELLO);
    ws.deliver({ ...CONNECTED, invited: true });
    ws.deliver(SYNCED);
    await flush();

    const before = ws.sent.length;
    useAppStore.getState().createInvite();
    const state = useAppStore.getState();
    expect(state.inviteStatus).toBe("error");
    expect(state.inviteError).toBe("invite_forbidden");
    expect(ws.sent).toHaveLength(before);
  });

  it("服务端 inviteError：显示稳定错误码，不留在 loading", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await login(ws);

    useAppStore.getState().createInvite();
    ws.deliver({ type: "inviteError", code: "invite_failed", reason: "boom" });
    const state = useAppStore.getState();
    expect(state.inviteStatus).toBe("error");
    expect(state.inviteError).toBe("invite_failed");
    expect(state.inviteLink).toBeNull();
  });

  it("网页邀请关闭：不发送请求，返回 invite_unavailable", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await flush();
    ws.deliver({ ...HELLO, inviteEnabled: false });
    ws.deliver(CONNECTED);
    ws.deliver(SYNCED);
    await flush();

    const before = ws.sent.length;
    useAppStore.getState().createInvite();
    const state = useAppStore.getState();
    expect(state.inviteEnabled).toBe(false);
    expect(state.inviteStatus).toBe("error");
    expect(state.inviteError).toBe("invite_unavailable");
    expect(ws.sent).toHaveLength(before);
  });

  it("创建邀请时断线：退出 loading，标记网络失败", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await login(ws);

    useAppStore.getState().createInvite();
    expect(useAppStore.getState().inviteStatus).toBe("loading");
    ws.drop(1006);
    const state = useAppStore.getState();
    expect(state.connState).toBe("reconnecting");
    expect(state.inviteStatus).toBe("error");
    expect(state.inviteError).toBe("invite_network");
  });

  it("创建邀请超时：退出 loading，可重试", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await login(ws);

    useAppStore.getState().createInvite();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useAppStore.getState().inviteStatus).toBe("error");
    expect(useAppStore.getState().inviteError).toBe("invite_network");

    const before = ws.sent.length;
    useAppStore.getState().createInvite();
    expect(useAppStore.getState().inviteStatus).toBe("loading");
    expect(ws.sent).toHaveLength(before + 1);
  });

  it("重置邀请状态：清空链接与错误", async () => {
    useAppStore.getState().connect("alice", "pw123");
    const ws = MockWS.instances[0];
    await login(ws);
    useAppStore.getState().createInvite();
    ws.deliver(INVITE);

    useAppStore.getState().resetInvite();
    const state = useAppStore.getState();
    expect(state.inviteStatus).toBe("idle");
    expect(state.inviteLink).toBeNull();
    expect(state.inviteError).toBe("");
  });
});
