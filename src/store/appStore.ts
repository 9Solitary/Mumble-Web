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
  remoteStreams: Record<number, MediaStream>;
  volumes: Record<number, number>; // session -> 0..1.5

  currentChannelId: number; // 当前查看的频道（默认跟随自己）
  micReady: boolean;
  micError: string;
  pttMode: "ptt" | "open"; // 按键说话 / 自由发言
  transmitting: boolean; // 正在对服务器发送语音
  selfMuted: boolean;
  selfDeafened: boolean;

  // actions
  connect: (username: string, password: string) => void;
  disconnect: () => void;
  handleMessage: (env: Envelope) => void;
  joinChannel: (id: number) => void;
  sendText: (channelId: number, text: string) => void;
  setSelfMute: (mute: boolean) => void;
  setSelfDeaf: (deaf: boolean) => void;
  setPttMode: (mode: "ptt" | "open") => void;
  setTransmitting: (on: boolean) => void;
  setVolume: (session: number, v: number) => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const client = new MumbleClient();

  client.onMessage = (env) => get().handleMessage(env);
  client.onClose = () => {
    if (get().connState !== "idle") {
      set({ connState: "failed", error: "与代理服务器的连接已断开" });
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
  client.onMicReady = () => set({ micReady: true });
  client.onMicError = (err) => set({ micError: err });

  // 根据 PTT 模式与静音状态同步「实际是否在发送」
  const applyMicGate = () => {
    const { pttMode, transmitting, selfMuted, selfDeafened } = get();
    const open = pttMode === "open" ? !selfMuted && !selfDeafened : transmitting && !selfMuted && !selfDeafened;
    client.setMicEnabled(open);
    client.send({ type: "ptt", active: open });
  };

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
    remoteStreams: {},
    volumes: {},
    currentChannelId: 0,
    micReady: false,
    micError: "",
    pttMode: "ptt",
    transmitting: false,
    selfMuted: false,
    selfDeafened: false,

    connect: (username, password) => {
      set({ connState: "connecting", error: "" });
      client.connect();
      // WS open 后发送登录；hello 消息到达即代表 WS 就绪
      const iv = setInterval(() => {
        client.send({ type: "connect", username, password });
      }, 300);
      setTimeout(() => clearInterval(iv), 10000);
      const origHandler = get().handleMessage;
      client.onMessage = (env) => {
        if (env.type === "hello") clearInterval(iv);
        origHandler(env);
      };
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
        remoteStreams: {},
        micReady: false,
        micError: "",
        transmitting: false,
        selfMuted: false,
        selfDeafened: false,
      });
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
            });
            // 登录成功后立即建立语音
            client.startAudio();
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
            // 自己换频道时跟随
            if (s.self && env.user.session === s.self.session) {
              set({
                currentChannelId: env.user.channelId,
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

    joinChannel: (id) => {
      client.send({ type: "joinChannel", channelId: id });
      set({ currentChannelId: id });
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
  };
});
