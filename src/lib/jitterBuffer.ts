// 接收端抖动缓冲控制：RTCRtpReceiver.jitterBufferTarget 是「偏好提示」（毫秒），
// 不是硬上限——浏览器仍按网络状况自适应调整，只是目标锚定在设定值附近，
// 避免 Chrome NetEQ 在抖动大时把缓冲自动推到 100ms+ 以上。
import { logEvent } from "./diagnostics";

export const LOW_LATENCY_BUFFER_MS = 100; // 低延迟模式的目标缓冲
const FALLBACK_BUFFER_MS = 3000; // 关闭时 null 赋值不被接受的大值兜底

let loggedUnsupported = false;

// 特性检测：老浏览器无此属性时静默跳过（只记一次诊断事件）
export function isJitterBufferTargetSupported(): boolean {
  const ok =
    typeof RTCRtpReceiver !== "undefined" &&
    "jitterBufferTarget" in RTCRtpReceiver.prototype;
  if (!ok && !loggedUnsupported) {
    loggedUnsupported = true;
    logEvent("jitter-buffer", { supported: false });
  }
  return ok;
}

// 对单个 receiver 应用当前设置；返回是否实际写入
export function applyJitterBufferTarget(
  receiver: RTCRtpReceiver,
  lowLatency: boolean,
): boolean {
  if (!isJitterBufferTargetSupported()) return false;
  try {
    // null = 清除目标，恢复浏览器默认自适应（WebRTC spec 中该属性可空）
    receiver.jitterBufferTarget = lowLatency ? LOW_LATENCY_BUFFER_MS : null;
    return true;
  } catch {
    if (lowLatency) return false;
    try {
      // 个别实现不接受 null：用大值兜底（等价于几乎不限制缓冲）
      receiver.jitterBufferTarget = FALLBACK_BUFFER_MS;
      return true;
    } catch {
      return false;
    }
  }
}

// 测试专用：重置「不支持」日志的一次性标记
export function resetJitterBufferForTest() {
  loggedUnsupported = false;
}
