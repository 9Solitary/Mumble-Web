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
import { NoiseGate } from "@/lib/noiseGate";
import { computeMicGate } from "@/lib/micGate";
import { getClientId } from "@/lib/clientId";
import { CLIENT_ERROR_CODES, isSessionEndCode } from "@/lib/errorMessages";

export type ConnState =
  | "idle" // 未连接（显示登录页）
  | "connecting" // WS 已开，等待 Mumble 登录
  | "connected" // 已登录，同步中
  | "ready" // 频道树就绪
  | "reconnecting" // 异常断线，自动重连中
  | "failed" // 被拒/断开/放弃重连
  | "ended"; // 会话被顶/被踢/抖动保护：停在终止页，不自动重连

// 连续重连失败上限：超过后置 failed，由用户手动重试
const MAX_RECONNECT_ATTEMPTS = 10;

// 抖动保护：短连接反复出现时停止重连，避免异常短连接无限循环。
const FLAP_WINDOW_MS = 60_000;
const FLAP_SHORT_MS = 15_000;
const FLAP_LIMIT = 3;
const DEFAULT_AUTO_THRESHOLD = 0.008;

// ---- 本地设置持久化 ----
const SETTINGS_KEY = "mumble-web.settings";
const SETTINGS_VERSION = 2;

interface PersistedSettings {
  version?: number;
  inputDeviceId?: string;
  outputDeviceId?: string;
  vadThreshold?: number;
  continuousTransmit?: boolean; // 显式常开麦克风（音乐/测试）；默认关
  micGain?: number; // 输入音量 0..2
  outputVolume?: number; // 全局输出音量 0..1.5
  lowLatencyBuffer?: boolean; // 低延迟接收缓冲（缺省视为 true）
}

function loadSettings(): PersistedSettings {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? "{}",
    ) as PersistedSettings;
    if (!parsed || typeof parsed !== "object") return {};
    if (!parsed.version) {
      // v1 及更早没有 version；旧默认/误存 outputVolume=0 会让用户完全没声音。
      // 只在缺少版本号时迁移一次，之后用户主动把输出拖到 0 仍会保留。
      const migrated: PersistedSettings = {
        ...parsed,
        version: SETTINGS_VERSION,
        outputVolume: parsed.outputVolume === 0 ? 1 : parsed.outputVolume,
      };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
      } catch {
        /* 隐私模式 */
      }
      return migrated;
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveSettings(patch: PersistedSettings) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...loadSettings(), ...patch, version: SETTINGS_VERSION }),
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
  vadThreshold: number; // 自由发言触发阈值 0..0.5（0 = 自动噪声门）
  vadThresholdEffective: number; // 当前实际触发点（自动模式随环境变化）
  continuousTransmit: boolean; // 持续传输（显式常开，默认关）
  micGain: number; // 麦克风增益 0..2（UserBar 悬浮滑条）
  outputVolume: number; // 全局输出音量 0..1.5，与单人音量相乘
  lowLatencyBuffer: boolean; // 低延迟接收缓冲（jitterBufferTarget=100ms）
  vadActive: boolean; // VAD 当前是否开门（内部状态）
  reconnectAttempt: number; // 本轮重连已尝试次数（重连成功后清零）
  reconnectCount: number; // 累计重连成功次数（诊断面板展示）
  endCode: string; // 终止原因 code（session_takeover / username_in_use / ...）
  endDetail: string; // 服务端原始 reason，仅作详情展示

  // actions
  connect: (username: string, password: string, serverAddr?: string, inviteToken?: string) => void;
  disconnect: () => void;
  retryAfterEnd: () => void; // 终止页“重新进入”：复用凭据重新连接
  returnToConnect: () => void; // 终止页“换个昵称”：回连接页
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
  setContinuousTransmit: (on: boolean) => void;
  setMicGain: (v: number) => void;
  setOutputVolume: (v: number) => void;
  setLowLatencyBuffer: (on: boolean) => void;
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
  let suspendReconnect = false; // 终止态：不再自动重连（被顶/被踢/抖动保护）
  let connectedAt = 0; // 最近一次登录成功时间，用于抖动保护
  let flapTimes: number[] = []; // 短连接断开时间点（60s 窗口）
  let gate: NoiseGate | null = null; // 自动噪声门实例（每次进入自由发言重建）
  const backoff = createBackoff();

  client.onMessage = (env) => {
    if (env.type === "hello") helloReceived = true;
    get().handleMessage(env);
  };
  client.onClose = (code) => {
    // 主动断开 / 页面销毁 / 终止态：不进入重连
    if (manualDisconnect || pageHiding || suspendReconnect) return;
    // 兜底：代理用 4001 关闭表示“会话被接管/被踢”，即使 disconnected 信封丢了也停住。
    if (code === 4001 && get().connState !== "ended") {
      endSession("session_takeover", "");
      return;
    }
    const st = get().connState;
    if (st === "idle" || st === "failed" || st === "ended") return;
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

  // 构造 connect 信封：邀请用户优先用 resumeToken（契约 3，与 password/inviteToken 互斥）。
  // clientId 每个标签页稳定：服务端据此区分“自己重连”和“别人同名登录”。
  const buildConnectEnvelope = (): Envelope | null => {
    const clientId = getClientId();
    if (resumeToken && savedCreds) {
      return { type: "connect", username: savedCreds.username, clientId, resumeToken };
    }
    if (!savedCreds) return null;
    const { username, password, serverAddr, inviteToken } = savedCreds;
    return {
      type: "connect",
      username,
      clientId,
      ...(inviteToken
        ? { inviteToken }
        : { password, ...(serverAddr ? { serverAddr } : {}) }),
    };
  };

  // 终止态：被接管/被踢/抖动保护。保留内存凭据供“重新进入”，但不再自动重连。
  const endSession = (code: string, detail: string) => {
    if (get().connState === "ended") return;
    suspendReconnect = true;
    cancelReconnect();
    gate = null;
    logEvent("session-end", { code, detail: detail.slice(0, 200) });
    client.dispose();
    set({
      connState: "ended",
      endCode: code,
      endDetail: detail,
      error: "",
      selfTalking: false,
      transmitting: false,
      vadActive: false,
      selfMuted: false,
      selfDeafened: false,
      micReady: false,
      micError: "",
      remoteStreams: {},
      talking: {},
      reconnectAttempt: 0,
      channels: {},
      users: {},
    });
  };

  // 首次异常断开：关旧 RTC（保留麦克风流），进入 reconnecting
  const beginReconnect = () => {
    if (suspendReconnect) return;
    if (!savedCreds) {
      // 没有可重放的凭据，退化为旧的失败提示
      set({
        connState: "failed",
        error: helloReceived
          ? CLIENT_ERROR_CODES.proxyDisconnected
          : CLIENT_ERROR_CODES.proxyUnreachable,
      });
      return;
    }

    // 抖动保护：15s 内连上又断，60s 内出现 3 次就停下，避免异常短连接无限重连。
    if (connectedAt) {
      const now = Date.now();
      if (now - connectedAt < FLAP_SHORT_MS) {
        flapTimes = flapTimes.filter((t) => now - t < FLAP_WINDOW_MS);
        flapTimes.push(now);
        if (flapTimes.length >= FLAP_LIMIT) {
          endSession("flap_guard", "");
          return;
        }
      } else {
        flapTimes = [];
      }
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
            ? CLIENT_ERROR_CODES.reconnectFailed
            : CLIENT_ERROR_CODES.proxyUnreachable),
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
      set({
        connState: "failed",
        error: CLIENT_ERROR_CODES.missingCredentials,
      });
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

  // 根据 PTT 模式、噪声门与静音状态同步「实际是否在发送」。
  // 阈值 0 = 自动噪声门；持续传输是独立开关，不再用 0 表示。
  const applyMicGate = () => {
    const {
      pttMode,
      transmitting,
      selfMuted,
      selfDeafened,
      micReady,
      vadActive,
      continuousTransmit,
    } = get();
    const open = computeMicGate({
      pttMode,
      transmitting,
      selfMuted,
      selfDeafened,
      micReady,
      vadActive,
      continuousTransmit,
    });
    client.setMicEnabled(open);
    client.send({ type: "ptt", active: open });
    // murmur 不回传本人语音，自己的说话指示由本地门控状态驱动
    if (get().selfTalking !== open) set({ selfTalking: open });
    ensureVadLoop();
  };

  // 自由发言下的门控轮询：自动模式按环境噪声自适应，手动模式用固定阈值。
  // 持续传输开启时不轮询，直接常开。
  let vadTimer: number | null = null;
  const ensureVadLoop = () => {
    const { pttMode, micReady, continuousTransmit, vadThreshold } = get();
    const need = pttMode === "open" && micReady && !continuousTransmit;
    if (need && vadTimer == null) {
      if (!gate) gate = new NoiseGate();
      gate.manualThreshold = vadThreshold > 0 ? vadThreshold : null;
      vadTimer = window.setInterval(() => {
        if (!gate) gate = new NoiseGate();
        const state = get();
        gate.manualThreshold = state.vadThreshold > 0 ? state.vadThreshold : null;
        const result = gate.update(client.getMicLevel());
        if (Math.abs(result.threshold - state.vadThresholdEffective) > 0.001) {
          set({ vadThresholdEffective: result.threshold });
        }
        if (result.active !== state.vadActive) {
          set({ vadActive: result.active });
          applyMicGate();
        }
      }, 50);
    } else if (!need && vadTimer != null) {
      clearInterval(vadTimer);
      vadTimer = null;
      gate = null;
      if (get().vadActive) set({ vadActive: false });
    }
  };

  const persisted = loadSettings();
  client.setMicGain(persisted.micGain ?? 1); // 把持久化的增益同步进音频链
  client.setLowLatencyBuffer(persisted.lowLatencyBuffer ?? true); // 默认开启低延迟接收缓冲

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
    pttMode: "open", // 默认自由发言（可在设置或用户栏切换为按键说话）
    transmitting: false,
    selfMuted: false,
    selfDeafened: false,
    inputDeviceId: persisted.inputDeviceId ?? "",
    outputDeviceId: persisted.outputDeviceId ?? "",
    vadThreshold: persisted.vadThreshold ?? 0,
    vadThresholdEffective: DEFAULT_AUTO_THRESHOLD,
    continuousTransmit: persisted.continuousTransmit ?? false,
    micGain: persisted.micGain ?? 1,
    outputVolume: persisted.outputVolume ?? 1,
    lowLatencyBuffer: persisted.lowLatencyBuffer ?? true,
    vadActive: false,
    reconnectAttempt: 0,
    reconnectCount: 0,
    endCode: "",
    endDetail: "",

    connect: (username, password, serverAddr, inviteToken) => {
      set({
        connState: "connecting",
        error: "",
        inviteToken: inviteToken ?? null,
        endCode: "",
        endDetail: "",
      });
      helloReceived = false;
      manualDisconnect = false;
      suspendReconnect = false;
      connectedAt = 0;
      flapTimes = [];
      gate = null;
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

    retryAfterEnd: () => {
      if (!savedCreds) {
        get().disconnect();
        return;
      }
      manualDisconnect = false;
      suspendReconnect = false;
      connectedAt = 0;
      flapTimes = [];
      gate = null;
      cancelReconnect();
      set({
        connState: "connecting",
        error: "",
        endCode: "",
        endDetail: "",
        reconnectAttempt: 0,
        self: null,
        selfTalking: false,
        transmitting: false,
        vadActive: false,
      });
      client.onOpen = () => {
        const env = buildConnectEnvelope();
        if (env) client.send(env);
      };
      client.connect();
    },

    returnToConnect: () => {
      get().disconnect();
    },

    disconnect: () => {
      manualDisconnect = true; // 主动断开：onClose 不触发重连
      suspendReconnect = false;
      connectedAt = 0;
      flapTimes = [];
      gate = null;
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
        vadThresholdEffective: DEFAULT_AUTO_THRESHOLD,
        reconnectAttempt: 0,
        maxMessageLength: 5000,
        maxImageMessageLength: 131072,
        endCode: "",
        endDetail: "",
        error: "",
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
            connectedAt = Date.now();
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
          if (isSessionEndCode(env.code)) {
            endSession(env.code, env.reason || "");
            break;
          }
          set({
            connState: "failed",
            reconnectAttempt: 0,
            error: env.reason || CLIENT_ERROR_CODES.loginRejected,
            endCode: env.code || "",
          });
          break;
        case "disconnected":
          // 契约 4：服务端先推 disconnected 再以 1011 关 WS，重连由 onClose 驱动；
          // 但被顶/被踢/封禁属于终止态，必须在这里停住，否则会跟另一处互相顶。
          if (isSessionEndCode(env.code)) {
            endSession(env.code, env.reason || "");
            break;
          }
          set({ error: env.reason || CLIENT_ERROR_CODES.disconnected });
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
          console.warn("[mumble]", env.reason);
          break;
        case "error":
          cancelReconnect();
          if (get().connState === "connecting") {
            set({
              connState: "failed",
              error: env.reason || "",
              endCode: env.code || "",
            });
          } else {
            console.warn("[mumble]", env.reason);
          }
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
      gate = null;
      set({ pttMode: mode, vadActive: false });
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
      gate = null; // 换设备后重新估计环境噪声
      set({ inputDeviceId: id, micError: "" });
      saveSettings({ inputDeviceId: id });
      void client.setInputDevice(id);
    },
    setOutputDevice: (id) => {
      set({ outputDeviceId: id });
      saveSettings({ outputDeviceId: id });
    },
    setVadThreshold: (v) => {
      const threshold = Math.min(0.5, Math.max(0, v));
      if (gate) gate.manualThreshold = threshold > 0 ? threshold : null;
      set({ vadThreshold: threshold });
      saveSettings({ vadThreshold: threshold });
      applyMicGate();
    },
    setContinuousTransmit: (on) => {
      set({ continuousTransmit: on });
      saveSettings({ continuousTransmit: on });
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
    setLowLatencyBuffer: (on) => {
      set({ lowLatencyBuffer: on });
      saveSettings({ lowLatencyBuffer: on });
      client.setLowLatencyBuffer(on); // 对现有 receivers 即时生效
    },
  };
});
