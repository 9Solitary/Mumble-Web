// WebRTC 通话质量统计：每 5s 轮询 pc.getStats()，提取
// RTT / jitter / 丢包率 / 抖动缓冲区间延迟，写入诊断事件并暴露给诊断面板。
import { logEvent } from "./diagnostics";

export interface RtcStatsSnapshot {
  rttMs: number | null; // candidate-pair 当前往返时延（毫秒）
  jitterMs: number | null; // inbound-rtp(audio) jitter（毫秒）
  lossPct: number | null; // 累计丢包率 lost/(lost+received)（百分比）
  jitterBufferDelayMs: number | null; // 抖动缓冲区间延迟（Δdelay/Δcount，毫秒）
  connectionState: string;
  iceConnectionState: string;
  updatedAt: number; // unix 秒
}

// 抖动缓冲累计计数（jitterBufferDelay / jitterBufferEmittedCount 是累计值）
export interface JitterBufferCounter {
  delay: number; // 秒
  count: number;
}

// 由相邻两次采样的累计值计算区间平均延迟（毫秒）。
// count 无增长（区间内没有样本）时返回 null，跳过该次。
export function computeJitterBufferDelayMs(
  prev: JitterBufferCounter | null,
  cur: JitterBufferCounter,
): number | null {
  if (!prev) return null; // 首次采样没有上一次基准
  const dCount = cur.count - prev.count;
  if (dCount <= 0) return null;
  return ((cur.delay - prev.delay) / dCount) * 1000;
}

const EMPTY: RtcStatsSnapshot = {
  rttMs: null,
  jitterMs: null,
  lossPct: null,
  jitterBufferDelayMs: null,
  connectionState: "new",
  iceConnectionState: "new",
  updatedAt: 0,
};

let latest: RtcStatsSnapshot = { ...EMPTY };
let timer: number | null = null;
let prevJitterBuffer: JitterBufferCounter | null = null;

export function getLatestStats(): RtcStatsSnapshot {
  return latest;
}

export function startRtcStats(pc: RTCPeerConnection) {
  stopRtcStats();
  prevJitterBuffer = null;
  timer = window.setInterval(() => {
    if (pc.connectionState === "closed") {
      stopRtcStats();
      return;
    }
    void collect(pc);
  }, 5000);
}

export function stopRtcStats() {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  latest = { ...EMPTY };
  prevJitterBuffer = null;
}

async function collect(pc: RTCPeerConnection) {
  try {
    const report = await pc.getStats();
    const next: RtcStatsSnapshot = {
      rttMs: latest.rttMs,
      jitterMs: latest.jitterMs,
      lossPct: latest.lossPct,
      jitterBufferDelayMs: latest.jitterBufferDelayMs,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    report.forEach((r) => {
      // 当前使用的 candidate-pair：RTT
      if (
        r.type === "candidate-pair" &&
        (r.state === "succeeded" || r.nominated) &&
        typeof r.currentRoundTripTime === "number"
      ) {
        next.rttMs = r.currentRoundTripTime * 1000;
      }
      // inbound-rtp（音频）：jitter / 丢包率 / 抖动缓冲
      if (r.type === "inbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) {
        if (typeof r.jitter === "number") next.jitterMs = r.jitter * 1000;
        const lost = r.packetsLost ?? 0;
        const received = r.packetsReceived ?? 0;
        if (lost + received > 0) {
          next.lossPct = (lost / (lost + received)) * 100;
        }
        if (
          typeof r.jitterBufferDelay === "number" &&
          typeof r.jitterBufferEmittedCount === "number"
        ) {
          const cur: JitterBufferCounter = {
            delay: r.jitterBufferDelay,
            count: r.jitterBufferEmittedCount,
          };
          const intervalMs = computeJitterBufferDelayMs(prevJitterBuffer, cur);
          // 区间内 count 无增长则保留上一次的有效值
          if (intervalMs != null) next.jitterBufferDelayMs = intervalMs;
          prevJitterBuffer = cur;
        }
      }
    });
    latest = next;
    // 写入诊断事件（远端上报由诊断模块按采样规则决定）
    logEvent("rtc-stats", {
      rttMs: next.rttMs != null ? Math.round(next.rttMs) : null,
      jitterMs: next.jitterMs != null ? Math.round(next.jitterMs * 10) / 10 : null,
      lossPct: next.lossPct != null ? Math.round(next.lossPct * 100) / 100 : null,
      jitterBufferDelayMs:
        next.jitterBufferDelayMs != null
          ? Math.round(next.jitterBufferDelayMs * 10) / 10
          : null,
      connectionState: next.connectionState,
      iceConnectionState: next.iceConnectionState,
    });
  } catch {
    /* getStats 失败（如连接已关闭）时跳过本次 */
  }
}
