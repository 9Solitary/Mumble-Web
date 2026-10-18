// 前端诊断模块：内存环形缓冲 + 可选远端上报。
//
// 隐私红线：绝不记录聊天内容、密码、用户名、SDP / ICE candidate 原文、
// URL 中的 invite token。事件 data 只放非敏感字段（状态名、错误码、
// 截断到 200 字符的错误 message），敏感键名在写入时直接剔除。
//
// 本地缓冲常开；远端上报默认关闭，仅在 VITE_DIAG_ENABLED === '1' 时启用：
// 错误类事件全量上报，其余按 5% 采样；批量 POST /api/diag（最多每 10s 一批），
// pagehide 时用 navigator.sendBeacon 兜底发送剩余事件。

import { apiUrl } from "./backend";

export interface DiagEvent {
  ts: number; // unix 秒
  kind: string;
  data: Record<string, unknown>;
}

const MAX_EVENTS = 500;
const FLUSH_INTERVAL_MS = 10_000;
const SAMPLE_RATE = 0.05;

// 错误类事件：上报时全量（不采样）
const ERROR_KINDS = new Set([
  "error",
  "unhandledrejection",
  "react-error",
  "gum-error",
]);

// 敏感键名：写入缓冲前剔除，防止密码 / token / 聊天内容 / SDP 等落盘
const SENSITIVE_KEY = /password|token|invite|secret|username|sdp|candidate/i;

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (v == null) out[k] = v;
    // 对象 / 数组一律忽略，避免夹带敏感内容
  }
  return out;
}

let events: DiagEvent[] = [];
let pending: DiagEvent[] = []; // 待上报队列
let sid = "";
let version = "";
let flushTimer: number | null = null;
let initialized = false;

// 上报开关：默认关闭，仅 VITE_DIAG_ENABLED === '1' 时启用
export function isReportEnabled(): boolean {
  return import.meta.env.VITE_DIAG_ENABLED === "1";
}

// 记录当前 WS 会话（hello 信封下发）
export function setSession(newSid: string, newVersion: string) {
  sid = newSid;
  version = newVersion;
}

export function getSession(): { sid: string; version: string } {
  return { sid, version };
}

export function logEvent(kind: string, data: Record<string, unknown> = {}) {
  const ev: DiagEvent = {
    ts: Math.floor(Date.now() / 1000),
    kind,
    data: sanitize(data),
  };
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  if (!isReportEnabled()) return;
  // 错误类全量，其余按 5% 采样
  if (!ERROR_KINDS.has(kind) && Math.random() >= SAMPLE_RATE) return;
  pending.push(ev);
  scheduleFlush();
}

export function getEvents(): DiagEvent[] {
  return [...events];
}

// 诊断面板「复制/导出」用：会话信息 + 全部本地事件
export function exportJSON(): string {
  return JSON.stringify({ sid, version, events }, null, 2);
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush() {
  if (pending.length === 0 || !isReportEnabled()) return;
  const batch = pending;
  pending = [];
  try {
    await fetch(apiUrl("/api/diag"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid, version, events: batch }),
    });
  } catch {
    // 失败丢弃，不重试（避免诊断本身制造流量风暴）
  }
}

// pagehide 兜底：sendBeacon 发送剩余事件
function flushBeacon() {
  if (pending.length === 0 || !isReportEnabled()) return;
  const body = JSON.stringify({ sid, version, events: pending });
  pending = [];
  try {
    navigator.sendBeacon(
      apiUrl("/api/diag"),
      new Blob([body], { type: "application/json" }),
    );
  } catch {
    /* sendBeacon 不可用时静默放弃 */
  }
}

// 安装全局捕获：window 错误 / Promise 拒绝 / 可见性 / 网络状态
function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.onerror = (message, source, lineno, colno) => {
    logEvent("error", {
      message: String(message),
      source: source ?? "",
      lineno: lineno ?? 0,
      colno: colno ?? 0,
    });
  };
  window.onunhandledrejection = (ev) => {
    const reason = ev.reason;
    logEvent("unhandledrejection", {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  };
  document.addEventListener("visibilitychange", () => {
    logEvent("visibility", { state: document.visibilityState });
  });
  window.addEventListener("online", () => logEvent("online"));
  window.addEventListener("offline", () => logEvent("offline"));
  window.addEventListener("pagehide", flushBeacon);
}

init();

// 测试专用：重置全部内部状态
export function resetDiagnosticsForTest() {
  events = [];
  pending = [];
  sid = "";
  version = "";
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
