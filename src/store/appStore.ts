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

export type ConnState =
  | "idle" // 未连接（显示登录页）
  | "connecting" // WS 已开，等待 Mumble 登录
  | "connected" // 已登录，同步中
  | "ready" // 频道树就绪
  | "failed"; // 被拒/断开

// ---- 本地设置持久化 ----
const SETTINGS_KEY = "mumble-web.settings";

interface PersistedSettings {
  inputDeviceId?: string;
  outputDeviceId?: string;
  vadThreshold?: number;
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
  vadActive: boolean; // VAD 当前是否开门（内部状态）

  // actions
  connect: (username: string, password: string, serverAddr?: string) => void;
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
}

export const useAppStore = create<AppState>((set, get) => {
  const client = new MumbleClient();
  let helloReceived = false;

  client.onMessage = (env) => {
    if (env.type === "hello") helloReceived = true;
    get().handleMessage(env);
  };
  client.onClose = () => {
    if (get().connState !== "idle") {
      set({
        connState: "failed",
        error: helloReceived
          ? "与代理服务器的连接已断开"
          : "无法连接代理服务器：WebSocket 被网络环境阻断（若在使用在线预览，可能是预览网关不支持 WebSocket，请用 Docker 部署体验完整功能）",
      });
    }
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

  return {
    client,
    connState: "idle",
    error: "",
    server: null,
    self: null,
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
    vadActive: false,

    connect: (username, password, serverAddr) => {
      set({ connState: "connecting", error: "" });
      helloReceived = false;
      saveIdentity({ username, serverAddr });
      // WS 打开后立即发送登录请求（onopen 回调，不靠定时器猜测时序）
      client.onOpen = () =>
        client.send({
          type: "connect",
          username,
          password,
          ...(serverAddr ? { serverAddr } : {}),
        });
      client.connect();
    },

    disconnect: () => {
      client.dispose();
      set({
        connState: "idle",
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
        maxMessageLength: 5000,
        maxImageMessageLength: 131072,
      });
      applyMicGate(); // 停止 VAD 轮询并复位门控
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
        case "connected":
          if (env.self) {
            set({
              connState: "connected",
              self: env.self,
              currentChannelId: env.self.channelId,
              selectedChannelId: env.self.channelId,
            });
            // 登录成功后立即建立语音
            void client.startAudio(get().inputDeviceId || undefined);
          }
          break;
        case "synced":
          set({ connState: "ready" });
          break;
        case "reject":
          set({ connState: "failed", error: env.reason || "登录被拒绝" });
          break;
        case "disconnected":
          set({ connState: "failed", error: env.reason || "已断开" });
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
  };
});
