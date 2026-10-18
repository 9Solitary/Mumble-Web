import { create } from "zustand";
import type {
  ChannelInfo,
  Envelope,
  SelfInfo,
  ServerInfo,
  TextMessageInfo,
  UserInfo,
} from "@/lib/protocol";
import { MumbleClient } from "@/lib/mumbleClient";
import { createBackoff } from "@/lib/reconnect";
import { logEvent } from "@/lib/diagnostics";

export type ConnState =
  | "idle" // 未连接（显示登录页）
  | "connecting" // WS 已开，等待 Mumble 登录
  | "connected" // 已登录，同步中
  | "ready" // 频道树就绪
  | "reconnecting" // 异常断线，自动重连中
  | "failed"; // 被拒/断开/放弃重连

// 连续重连失败上限：超过后置 failed，由用户手动重试
const MAX_RECONNECT_ATTEMPTS = 10;

// ---- 本地设置持久化 ----
const SETTINGS_KEY = "mumble-web.settings";

interface PersistedSettings {
  inputDeviceId?: string;
  outputDeviceId?: string;
  vadThreshold?: number;
  micGain?: number; // 麦克风增益 0..2
  outputVolume?: number; // 全局输出音量 0..1.5
}

function loadSettings(): PersistedSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSettings(patch: PersistedSettings) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...loadSettings(), ...patch }),
    );
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}

// ---- 上次连接身份（用户名/服务器）记忆，供连接页预填 ----
const IDENTITY_KEY = "mumble-web.lastIdentity";

export interface LastIdentity {
  username?: string;
  serverAddr?: string; // "" 或缺省 = 使用代理默认服务器
}

export function loadIdentity(): LastIdentity {
  try {
    return JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveIdentity(patch: LastIdentity) {
  try {
    localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ ...loadIdentity(), ...patch }),
    );
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}

interface AppState {
  client: MumbleClient;
  connState: ConnState;
  error: string;
  server: ServerInfo | null;
  self: SelfInfo | null;
  inviteToken: string | null; // 本次会话使用的一次性邀请 token（退出登录后作废并清除）

  channels: Record<number, ChannelInfo>;
  users: Record<number, UserInfo>;
  messages: Record<number, TextMessageInfo[]>; // channelId -> 消息
  talking: Record<number, boolean>;
  selfTalking: boolean; // 自己正在发送语音（本地门控状态，murmur 不回传本人）
  remoteStreams: Record<number, MediaStream>;
  volumes: Record<number, number>; // session -> 0..1.5
  localMuted: Record<number, boolean>; // session -> 本地屏蔽（音量强制为 0）

  currentChannelId: number; // 当前查看的频道（始终跟随自己所在频道）
  selectedChannelId: number; // 单击选中的频道（仅高亮，不影响聊天视图）
  maxMessageLength: number; // 服务器纯文本消息长度上限（config 信封下发，默认 5000）
  maxImageMessageLength: number; // 含图片消息长度上限（默认 131072）
  micReady: boolean;
  micError: string;
  pttMode: "ptt" | "open"; // 按键说话 / 自由发言
  transmitting: boolean; // 正在对服务器发送语音
  selfMuted: boolean;
  selfDeafened: boolean;
  inputDeviceId: string; // 音频输入设备（"" = 系统默认）
  outputDeviceId: string; // 音频输出设备（"" = 系统默认）
  vadThreshold: number; // 自由发言触发阈值 0..1（0 = 持续传输）
  micGain: number; // 麦克风增益 0..2（UserBar 悬浮滑条）
  outputVolume: number; // 全局输出音量 0..1.5，与单人音量相乘
  vadActive: boolean; // VAD 当前是否开门（内部状态）
  reconnectAttempt: number; // 本轮重连已尝试次数（重连成功后清零）
  reconnectCount: number; // 累计重连成功次数（诊断面板展示）

  // actions
  connect: (username: string, password: string, serverAddr?: string, inviteToken?: string) => void;
  disconnect: () => void;
  leaveVoice: () => void; // 离开当前语音频道，回到 root 大厅（不退出登录）
  handleMessage: (env: Envelope) => void;
  selectChannel: (id: number) => void;
  joinChannel: (id: number) => void;
  sendText: (channelId: number, text: string) => void;
  setSelfMute: (mute: boolean) => void;
  setSelfDeaf: (deaf: boolean) => void;
  setPttMode: (mode: "ptt" | "open") => void;
  setTransmitting: (on: boolean) => void;
  setVolume: (session: number, v: number) => void;
  toggleLocalMute: (session: number) => void;
  setInputDevice: (id: string) => void;
  setOutputDevice: (id: string) => void;
  setVadThreshold: (v: number) => void;
  setMicGain: (v: number) => void;
  setOutputVolume: (v: number) => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const client = new MumbleClient();
  let helloReceived = false;

  // ---- 重连状态（仅内存，凭据不持久化） ----
  interface SavedCreds {
    username: string;
    password: string;
    serverAddr?: string;
    inviteToken?: string;
  }
  let savedCreds: SavedCreds | null = null; // 重连重发 connect 用
  let resumeToken: string | null = null; // 邀请用户：服务端下发的断线恢复 token
  let manualDisconnect = false; // 用户主动断开/登出：不重连
  let pageHiding = false; // pagehide 触发：不重连（页面正在销毁）
  let reconnectTimer: number | null = null;
  let desiredChannelId = 0; // 断线前所在频道，重连后自动 rejoin
  let needRestore = false; // 重连登录成功，待 synced 后恢复静音/频道
  const backoff = createBackoff();

  client.onMessage = (env) => {
    if (env.type === "hello") helloReceived = true;
    get().handleMessage(env);
  };
  client.onClose = () => {
    // 主动断开 / 页面销毁 / 已是终态：不进入重连
    if (manualDisconnect || pageHiding) return;
    const st = get().connState;
    if (st === "idle" || st === "failed") return;
    if (st === "reconnecting") {
      scheduleNextAttempt(); // 重连尝试本身失败：继续下一轮退避
      return;
    }
    beginReconnect();
  };
  client.onRemoteTrack = (session, stream) =>
    set((s) => ({ remoteStreams: { ...s.remoteStreams, [session]: stream } }));
  client.onRemoteTrackEnded = (session) =>
    set((s) => {
      const streams = { ...s.remoteStreams };
      delete streams[session];
      return { remoteStreams: streams };
    });
  client.onMicReady = () => {
    set({ micReady: true });
    applyMicGate();
  };
  client.onMicError = (err) => set({ micError: err });

  // ---- 自动重连 ----

  // 构造 connect 信封：邀请用户优先用 resumeToken（契约 3，与 password/inviteToken 互斥）
  const buildConnectEnvelope = (): Envelope | null => {
    if (resumeToken && savedCreds) {
      return { type: "connect", username: savedCreds.username, resumeToken };
    }
    if (!savedCreds) return null;
    const { username, password, serverAddr, inviteToken } = savedCreds;
    return {
      type: "connect",
      username,
      ...(inviteToken
        ? { inviteToken }
        : { password, ...(serverAddr ? { serverAddr } : {}) }),
    };
  };

  // 首次异常断开：关旧 RTC（保留麦克风流），进入 reconnecting
  const beginReconnect = () => {
    if (!savedCreds) {
      // 没有可重放的凭据，退化为旧的失败提示
      set({
        connState: "failed",
        error: helloReceived
          ? "与代理服务器的连接已断开"
          : "无法连接代理服务器：WebSocket 被网络环境阻断（若在使用在线预览，可能是预览网关不支持 WebSocket，请用 Docker 部署体验完整功能）",
      });
      return;
    }
    desiredChannelId = get().self?.channelId ?? get().currentChannelId;
    client.closeRtc();
    logEvent("reconnect", { phase: "begin" });
    set({
      connState: "reconnecting",
      reconnectAttempt: 0,
      remoteStreams: {},
      talking: {},
      selfTalking: false,
    });
    scheduleNextAttempt();
  };

  const scheduleNextAttempt = () => {
    if (reconnectTimer != null) return; // 已有待执行的尝试
    const attempt = get().reconnectAttempt + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      logEvent("reconnect", { phase: "giveup", attempts: MAX_RECONNECT_ATTEMPTS });
      backoff.reset();
      set({
        connState: "failed",
        reconnectAttempt: 0,
        error:
          get().error ||
          (helloReceived
            ? "与代理服务器的连接已断开，自动重连失败，请手动重试"
            : "无法连接代理服务器：WebSocket 被网络环境阻断（若在使用在线预览，可能是预览网关不支持 WebSocket，请用 Docker 部署体验完整功能）"),
      });
      return;
    }
    const delay = backoff.next();
    set({ reconnectAttempt: attempt });
    logEvent("reconnect", { phase: "attempt", attempt, delayMs: delay });
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      doAttempt();
    }, delay);
  };

  const doAttempt = () => {
    const env = buildConnectEnvelope();
    if (!env) {
      set({ connState: "failed", error: "缺少重连凭据，请重新连接" });
      return;
    }
    client.onOpen = () => client.send(env);
    client.connect();
  };

  // 回前台 / 网络恢复：正在退避等待则立即重试；WS 已死但未进入重连则立即开始
  const retryNow = () => {
    const st = get().connState;
    if (st === "reconnecting") {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        doAttempt();
      }
      return;
    }
    if (
      (st === "connected" || st === "ready") &&
      (client.wsReadyState === WebSocket.CLOSED ||
        client.wsReadyState === WebSocket.CLOSING)
    ) {
      beginReconnect();
    }
  };

  // 重连且同步完成后：恢复静音/闭麦状态，自动 rejoin 断线前所在频道
  const restoreSession = () => {
    const { selfMuted, selfDeafened, channels } = get();
    if (selfMuted) client.send({ type: "setSelfMute", mute: true });
    if (selfDeafened) client.send({ type: "setSelfDeaf", deaf: true });
    const me = get().self;
    if (me && desiredChannelId !== me.channelId && channels[desiredChannelId]) {
      get().joinChannel(desiredChannelId);
    }
  };

  const cancelReconnect = () => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    backoff.reset();
    needRestore = false;
  };

  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") retryNow();
    });
    window.addEventListener("online", retryNow);
    window.addEventListener("pagehide", () => {
      pageHiding = true;
    });
  }

  // 根据 PTT 模式、VAD 与静音状态同步「实际是否在发送」
  const applyMicGate = () => {
    const { pttMode, transmitting, selfMuted, selfDeafened, micReady, vadThreshold, vadActive } =
      get();
    const gate =
      pttMode === "open"
        ? vadThreshold <= 0 || vadActive // 阈值为 0 = 持续传输
        : transmitting;
    const open = gate && !selfMuted && !selfDeafened && micReady;
    client.setMicEnabled(open);
    client.send({ type: "ptt", active: open });
    // murmur 不回传本人语音，自己的说话指示由本地门控状态驱动
    if (get().selfTalking !== open) set({ selfTalking: open });
    ensureVadLoop();
  };

  // 自由发言 + 阈值 > 0 时的 VAD 轮询：电平超过阈值开门，低于阈值保持 400ms 后关门
  let vadTimer: number | null = null;
  let vadLastVoice = 0;
  const ensureVadLoop = () => {
    const { pttMode, micReady, vadThreshold } = get();
    const need = pttMode === "open" && micReady && vadThreshold > 0;
    if (need && vadTimer == null) {
      vadLastVoice = 0;
      vadTimer = window.setInterval(() => {
        const { vadThreshold: th, vadActive } = get();
        const level = client.getMicLevel();
        if (level >= th) {
          vadLastVoice = Date.now();
          if (!vadActive) {
            set({ vadActive: true });
            applyMicGate();
          }
        } else if (vadActive && Date.now() - vadLastVoice > 400) {
          set({ vadActive: false });
          applyMicGate();
        }
      }, 50);
    } else if (!need && vadTimer != null) {
      clearInterval(vadTimer);
      vadTimer = null;
      if (get().vadActive) set({ vadActive: false });
    }
  };

  const persisted = loadSettings();
  client.setMicGain(persisted.micGain ?? 1); // 把持久化的增益同步进音频链

  return {
    client,
    connState: "idle",
    error: "",
    server: null,
    self: null,
    inviteToken: null,
    channels: {},
    users: {},
    messages: {},
    talking: {},
    selfTalking: false,
    remoteStreams: {},
    volumes: {},
    localMuted: {},
    currentChannelId: 0,
    selectedChannelId: 0,
    maxMessageLength: 5000,
    maxImageMessageLength: 131072,
    micReady: false,
    micError: "",
    pttMode: "ptt",
    transmitting: false,
    selfMuted: false,
    selfDeafened: false,
    inputDeviceId: persisted.inputDeviceId ?? "",
    outputDeviceId: persisted.outputDeviceId ?? "",
    vadThreshold: persisted.vadThreshold ?? 0,
    micGain: persisted.micGain ?? 1,
    outputVolume: persisted.outputVolume ?? 1,
    vadActive: false,
    reconnectAttempt: 0,
    reconnectCount: 0,

    connect: (username, password, serverAddr, inviteToken) => {
      set({ connState: "connecting", error: "", inviteToken: inviteToken ?? null });
      helloReceived = false;
      manualDisconnect = false;
      resumeToken = null;
      cancelReconnect();
      // 凭据只存内存（不落盘），供断线重连重放
      savedCreds = { username, password, serverAddr, inviteToken };
      saveIdentity(inviteToken ? { username } : { username, serverAddr });
      // WS 打开后立即发送登录请求（onopen 回调，不靠定时器猜测时序）
      // 邀请模式下不带密码与服务器地址，由代理按 token 存储的值登录
      client.onOpen = () => {
        const env = buildConnectEnvelope();
        if (env) client.send(env);
      };
      client.connect();
    },

    disconnect: () => {
      manualDisconnect = true; // 主动断开：onClose 不触发重连
      savedCreds = null;
      resumeToken = null;
      cancelReconnect();
      client.dispose();
      const wasInvite = get().inviteToken != null;
      set({
        connState: "idle",
        inviteToken: null,
        self: null,
        channels: {},
        users: {},
        messages: {},
        talking: {},
        selfTalking: false,
        remoteStreams: {},
        localMuted: {},
        selectedChannelId: 0,
        micReady: false,
        micError: "",
        transmitting: false,
        selfMuted: false,
        selfDeafened: false,
        vadActive: false,
        reconnectAttempt: 0,
        maxMessageLength: 5000,
        maxImageMessageLength: 131072,
      });
      applyMicGate(); // 停止 VAD 轮询并复位门控
      if (wasInvite) {
        // 一次性邀请退出登录后已作废，回到普通连接页
        window.history.replaceState(null, "", "/");
      }
    },

    // 挂断语音：移回 root 频道（大厅），保持登录与麦克风状态不变
    leaveVoice: () => {
      const root = Object.values(get().channels).find((c) => c.parentId < 0);
      get().joinChannel(root?.id ?? 0);
    },

    handleMessage: (env) => {
      const s = get();
      switch (env.type) {
        case "hello":
          if (env.server) set({ server: env.server });
          break;
        case "resume_token":
          // 邀请用户的断线恢复 token（仅内存保存，refresh 后走邀请流程重来）
          if (env.token) resumeToken = env.token;
          break;
        case "connected":
          if (env.self) {
            const wasReconnecting = s.connState === "reconnecting";
            if (wasReconnecting) {
              backoff.reset();
              needRestore = true;
              logEvent("reconnect", {
                phase: "success",
                attempts: s.reconnectAttempt,
              });
            }
            set({
              connState: "connected",
              error: "",
              self: env.self,
              currentChannelId: env.self.channelId,
              selectedChannelId: env.self.channelId,
              reconnectAttempt: 0,
              reconnectCount: wasReconnecting
                ? s.reconnectCount + 1
                : s.reconnectCount,
              // 重连后服务端会全量重发频道/用户，清空避免断线期间离开的用户成幽灵
              ...(wasReconnecting ? { channels: {}, users: {} } : {}),
            });
            // 登录成功后立即建立语音（重连时复用麦克风流，不重新弹权限）
            void client.startAudio(get().inputDeviceId || undefined);
          }
          break;
        case "synced":
          set({ connState: "ready" });
          if (needRestore) {
            needRestore = false;
            restoreSession();
          }
          break;
        case "reject":
          // 拒绝（含 resumeToken 失效）：不再重试，由用户手动重连
          cancelReconnect();
          set({ connState: "failed", reconnectAttempt: 0, error: env.reason || "登录被拒绝" });
          break;
        case "disconnected":
          // 契约 4：服务端先推 disconnected 再以 1011 关 WS，重连由 onClose 驱动；
          // 这里只记录原因，供放弃重连时展示
          set({ error: env.reason || "已断开" });
          break;
        case "channel":
          if (env.channel)
            set({ channels: { ...s.channels, [env.channel.id]: env.channel } });
          break;
        case "channelRemove":
          if (env.channelId != null) {
            const channels = { ...s.channels };
            delete channels[env.channelId];
            set({ channels });
          }
          break;
        case "user":
          if (env.user) {
            set({ users: { ...s.users, [env.user.session]: env.user } });
            // 自己换频道时跟随（聊天视图与选中高亮都跟到所在频道）
            if (s.self && env.user.session === s.self.session) {
              set({
                currentChannelId: env.user.channelId,
                selectedChannelId: env.user.channelId,
                self: { ...s.self, channelId: env.user.channelId },
                selfMuted: env.user.selfMuted,
                selfDeafened: env.user.selfDeafened,
              });
            }
          }
          break;
        case "userRemove":
          if (env.session != null) {
            const users = { ...s.users };
            delete users[env.session];
            const talking = { ...s.talking };
            delete talking[env.session];
            set({ users, talking });
          }
          break;
        case "textMessage":
          if (env.text) {
            const targets =
              env.text.channelIds.length > 0
                ? env.text.channelIds
                : [s.self?.channelId ?? 0];
            const messages = { ...s.messages };
            for (const cid of targets) {
              messages[cid] = [...(messages[cid] ?? []), env.text].slice(-200);
            }
            set({ messages });
          }
          break;
        case "talking":
          if (env.talking)
            set({
              talking: { ...s.talking, [env.talking.session]: env.talking.talking },
            });
          break;
        case "config":
          if (env.config)
            set({
              maxMessageLength: env.config.maxMessageLength || 5000,
              maxImageMessageLength:
                env.config.maxImageMessageLength || 131072,
            });
          break;
        case "permissionDenied":
        case "error":
          console.warn("[mumble]", env.reason);
          break;
        case "rtcOffer":
        case "rtcAnswer":
        case "rtcCandidate":
          client.handleSignaling(env);
          break;
      }
    },

    // 单击选中：仅高亮，不切换聊天视图、不加入语音（防止误解为已切换）
    selectChannel: (id) => {
      set({ selectedChannelId: id });
    },

    joinChannel: (id) => {
      client.send({ type: "joinChannel", channelId: id });
      set({ currentChannelId: id, selectedChannelId: id });
    },

    sendText: (channelId, text) => {
      client.send({ type: "sendText", channelId, message: text });
    },

    setSelfMute: (mute) => {
      client.send({ type: "setSelfMute", mute });
      set({ selfMuted: mute });
      applyMicGate();
    },
    setSelfDeaf: (deaf) => {
      client.send({ type: "setSelfDeaf", deaf });
      set({ selfDeafened: deaf, selfMuted: deaf ? true : get().selfMuted });
      if (deaf) client.send({ type: "setSelfMute", mute: true });
      applyMicGate();
    },
    setPttMode: (mode) => {
      set({ pttMode: mode });
      applyMicGate();
    },
    setTransmitting: (on) => {
      set({ transmitting: on });
      applyMicGate();
    },
    setVolume: (session, v) =>
      set({ volumes: { ...get().volumes, [session]: v } }),
    toggleLocalMute: (session) =>
      set({
        localMuted: {
          ...get().localMuted,
          [session]: !get().localMuted[session],
        },
      }),
    setInputDevice: (id) => {
      set({ inputDeviceId: id, micError: "" });
      saveSettings({ inputDeviceId: id });
      void client.setInputDevice(id);
    },
    setOutputDevice: (id) => {
      set({ outputDeviceId: id });
      saveSettings({ outputDeviceId: id });
    },
    setVadThreshold: (v) => {
      set({ vadThreshold: v });
      saveSettings({ vadThreshold: v });
      applyMicGate();
    },
    setMicGain: (v) => {
      set({ micGain: v });
      saveSettings({ micGain: v });
      client.setMicGain(v);
    },
    setOutputVolume: (v) => {
      set({ outputVolume: v });
      saveSettings({ outputVolume: v });
    },
  };
});
