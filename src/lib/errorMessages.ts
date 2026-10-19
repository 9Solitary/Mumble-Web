// 服务端只下发稳定 code，前端在这里映射到本地化文案。
// 原始 reason 只作为“详情”展示，避免把技术串直接怼给用户。

export type ErrorI18nKey =
  | "errors.generic"
  | "errors.pageTitle"
  | "errors.pageBody"
  | "errors.reload"
  | "errors.proxyDisconnected"
  | "errors.proxyUnreachable"
  | "errors.reconnectFailed"
  | "errors.missingCredentials"
  | "errors.loginRejected"
  | "errors.disconnected"
  | "errors.micAccess"
  | "errors.micSwitch"
  | "errors.micUnknown"
  | "errors.usernameInUse"
  | "errors.sessionTakeover"
  | "errors.kicked"
  | "errors.banned"
  | "errors.serverFull"
  | "errors.auth"
  | "errors.serverPassword"
  | "errors.tls"
  | "errors.network"
  | "errors.timeout"
  | "errors.closed"
  | "errors.flapGuard"
  | "errors.inviteUnavailable"
  | "errors.inviteInvalid"
  | "errors.resumeInvalid"
  | "errors.serverOverrideDenied"
  | "errors.serverUnreachable"
  | "errors.webrtcFailed"
  | "errors.invalidUsername"
  | "errors.versionMismatch"
  | "errors.unknown";

const ERROR_KEYS = {
  reject: "errors.generic",
  username_in_use: "errors.usernameInUse",
  session_takeover: "errors.sessionTakeover",
  kicked: "errors.kicked",
  banned: "errors.banned",
  server_full: "errors.serverFull",
  auth: "errors.auth",
  server_password: "errors.serverPassword",
  no_certificate: "errors.tls",
  tls: "errors.tls",
  network: "errors.network",
  timeout: "errors.timeout",
  closed: "errors.closed",
  flap_guard: "errors.flapGuard",
  invite_unavailable: "errors.inviteUnavailable",
  invite_invalid: "errors.inviteInvalid",
  resume_invalid: "errors.resumeInvalid",
  server_override_denied: "errors.serverOverrideDenied",
  server_unreachable: "errors.serverUnreachable",
  webrtc_failed: "errors.webrtcFailed",
  login_in_progress: "errors.usernameInUse",
  invalid_username: "errors.invalidUsername",
  version_mismatch: "errors.versionMismatch",
} as const satisfies Record<string, ErrorI18nKey>;

export function knownErrorKey(code?: string): ErrorI18nKey | null {
  if (!code) return null;
  return (ERROR_KEYS as Record<string, ErrorI18nKey>)[code] ?? null;
}

export function errorKey(code?: string): ErrorI18nKey {
  return knownErrorKey(code) ?? "errors.generic";
}

export type SessionEndKind =
  | "session_takeover"
  | "username_in_use"
  | "kicked"
  | "banned"
  | "flap_guard";

export type SessionTitleKey =
  | "session.takeoverTitle"
  | "session.usernameInUseTitle"
  | "session.kickedTitle"
  | "session.bannedTitle"
  | "session.flapTitle";

export type SessionBodyKey =
  | "session.takeoverBody"
  | "session.usernameInUseBody"
  | "session.kickedBody"
  | "session.bannedBody"
  | "session.flapBody";

const SESSION_COPY: Record<
  SessionEndKind,
  { title: SessionTitleKey; body: SessionBodyKey }
> = {
  session_takeover: {
    title: "session.takeoverTitle",
    body: "session.takeoverBody",
  },
  username_in_use: {
    title: "session.usernameInUseTitle",
    body: "session.usernameInUseBody",
  },
  kicked: { title: "session.kickedTitle", body: "session.kickedBody" },
  banned: { title: "session.bannedTitle", body: "session.bannedBody" },
  flap_guard: { title: "session.flapTitle", body: "session.flapBody" },
};

export function sessionCopy(code: string): {
  title: SessionTitleKey;
  body: SessionBodyKey;
} {
  return (
    SESSION_COPY[code as SessionEndKind] ?? SESSION_COPY.session_takeover
  );
}

export function isSessionEndCode(code?: string): code is SessionEndKind {
  return !!code && code in SESSION_COPY;
}

// appStore 只存稳定错误标识，不存面向用户的中文文案；
// 展示层在这里映射到本地化 key，未知错误继续走 errors.generic + 详情。
export const CLIENT_ERROR_CODES = {
  proxyDisconnected: "client_proxy_disconnected",
  proxyUnreachable: "client_proxy_unreachable",
  reconnectFailed: "client_reconnect_failed",
  missingCredentials: "client_missing_credentials",
  loginRejected: "client_login_rejected",
  disconnected: "client_disconnected",
} as const;

const CLIENT_ERROR_KEYS: Record<string, ErrorI18nKey> = {
  [CLIENT_ERROR_CODES.proxyDisconnected]: "errors.proxyDisconnected",
  [CLIENT_ERROR_CODES.proxyUnreachable]: "errors.proxyUnreachable",
  [CLIENT_ERROR_CODES.reconnectFailed]: "errors.reconnectFailed",
  [CLIENT_ERROR_CODES.missingCredentials]: "errors.missingCredentials",
  [CLIENT_ERROR_CODES.loginRejected]: "errors.loginRejected",
  [CLIENT_ERROR_CODES.disconnected]: "errors.disconnected",
};

export function clientErrorKey(message?: string | null): ErrorI18nKey | null {
  if (!message) return null;
  return CLIENT_ERROR_KEYS[message] ?? null;
}

// mumbleClient 的错误标识形如 mic_access: NotAllowedError；
// 只取稳定前缀做本地化摘要，原始技术细节留在控制台与诊断里。
export type MicErrorI18nKey =
  | "errors.micAccess"
  | "errors.micSwitch"
  | "errors.micUnknown";

export function micErrorKey(message?: string | null): MicErrorI18nKey | null {
  if (!message) return null;
  if (message.startsWith("mic_access")) return "errors.micAccess";
  if (message.startsWith("mic_switch")) return "errors.micSwitch";
  return null;
}

// image.ts 的错误标识会经 alert 展示给用户；这里做展示层映射，
// 不改图片压缩逻辑本身。
export type ImageErrorI18nKey =
  | "chat.imageSendFailed"
  | "chat.imageReadFailed"
  | "chat.imageDecodeFailed"
  | "chat.imageTooLarge";

export function imageErrorKey(message?: string | null): ImageErrorI18nKey | null {
  if (!message) return null;
  if (message === "image_read_failed") return "chat.imageReadFailed";
  if (message === "image_decode_failed") return "chat.imageDecodeFailed";
  if (message === "image_too_large") return "chat.imageTooLarge";
  return null;
}
