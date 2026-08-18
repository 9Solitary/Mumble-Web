// 与 Go 代理 WebSocket JSON 协议对应的类型定义

export interface ServerInfo {
  address: string;
  resolved: string;
  tlsMode: string;
  voice: string;
}

export interface SelfInfo {
  session: number;
  name: string;
  channelId: number;
  welcomeMessage?: string;
  maxMessageLength?: number;
}

export interface ChannelInfo {
  id: number;
  parentId: number; // -1 表示根
  name: string;
  description?: string;
  position: number;
  temporary: boolean;
}

export interface UserInfo {
  session: number;
  name: string;
  channelId: number;
  muted: boolean;
  deafened: boolean;
  suppressed: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  prioritySpeaker: boolean;
  registered: boolean;
  comment?: string;
}

export interface TextMessageInfo {
  sender: number;
  senderName: string;
  channelIds: number[];
  message: string;
  time: number;
}

export interface Envelope {
  type: string;
  username?: string;
  password?: string;
  session?: number;
  channelId?: number;
  message?: string;
  active?: boolean;
  mute?: boolean;
  deaf?: boolean;
  reason?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  server?: ServerInfo;
  self?: SelfInfo;
  channel?: ChannelInfo;
  user?: UserInfo;
  text?: TextMessageInfo;
  talking?: { session: number; talking: boolean };
}
