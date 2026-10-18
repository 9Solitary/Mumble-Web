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

export interface ConfigInfo {
  maxMessageLength: number; // 纯文本消息长度上限
  maxImageMessageLength: number; // 含图片消息长度上限
}

export interface Envelope {
  type: string;
  sid?: string; // hello 信封：本次 WS 会话 id（诊断上报关联用）
  version?: string; // hello 信封：代理版本（git sha 或 dev）
  username?: string;
  password?: string;
  serverAddr?: string; // connect 时可选：覆盖代理默认上游服务器
  inviteToken?: string; // connect 时可选：一次性邀请 token（服务器/密码以服务端存储为准）
  resumeToken?: string; // connect 时可选：断线恢复 token（与 password/inviteToken 互斥）
  token?: string; // resume_token 信封：断线恢复 token
  expiresAt?: number; // resume_token 信封：过期时间（unix 秒）
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
  config?: ConfigInfo;
  talking?: { session: number; talking: boolean };
}
