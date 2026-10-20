// 每个浏览器标签页一个稳定标识：sessionStorage 在同标签页刷新/断线重连时保留，
// 新标签页拿不到，因此服务端可以用它区分“自己重连”和“别人同名登录”。
export const CLIENT_ID_STORAGE_KEY = "mumble-web.clientId";

let fallbackId = "";

function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getClientId(): string {
  if (typeof window === "undefined") {
    if (!fallbackId) fallbackId = createClientId();
    return fallbackId;
  }
  try {
    const existing = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = createClientId();
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    if (!fallbackId) fallbackId = createClientId();
    return fallbackId;
  }
}
