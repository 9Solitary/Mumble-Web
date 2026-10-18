// WebRTC 通话质量统计：每 5s 轮询 pc.getStats()，提取
// RTT / jitter / 丢包率 / 抖动缓冲（区间水位 / 目标值 / 网络最低值），
// 写入诊断事件并暴露给诊断面板。
import { logEvent } from "./diagnostics";

export interface RtcStatsSnapshot {
  rttMs: number | null; // candidate-pair 当前往返时延（毫秒）
  jitterMs: number | null; // inbound-rtp(audio) jitter（毫秒）
  lossPct: number | null; // 累计丢包率 lost/(lost+received)（百分比）
  jitterBufferDelayMs: number | null; // 抖动缓冲区间实际水位（Δdelay/Δcount，毫秒）
  jitterBufferTargetMs: number | null; // NetEQ 当前目标延迟（毫秒）
  jitterBufferMinimumMs: number | null; // NetEQ 按当前网络条件认为的最低延迟（毫秒）
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

// getStats 报告中一条 inbound-rtp(audio) 条目（只取用到的字段）
export interface InboundAudioEntry {
  id: string; // 统计条目 id，同一 track 在多次采样间稳定
  jitterBufferDelay?: number; // 秒（累计）
  jitterBufferEmittedCount?: number; // 累计
  jitterBufferTargetDelay?: number; // 秒（瞬时值）
  jitterBufferMinimumDelay?: number; // 秒（瞬时值）
}

export interface JitterBufferResult {
  intervalDelayMs: number | null; // 各 track 区间水位的最大值
  targetMs: number | null;
  minimumMs: number | null;
}

// 多说话人时报告里有多条 inbound-rtp：按条目 id 分别保存上一次计数，
// 避免累计值跨 track 混算。区间水位 / 目标 / 最低值均取各 track 最大值
// （最保守，最能反映问题的那一路）。prev 由调用方持有，本函数就地更新。
export function computeJitterBufferStats(
  prev: Map<string, JitterBufferCounter>,
  entries: InboundAudioEntry[],
): JitterBufferResult {
  const result: JitterBufferResult = {
    intervalDelayMs: null,
    targetMs: null,
    minimumMs: null,
  };
  for (const r of entries) {
    if (
      typeof r.jitterBufferDelay === "number" &&
      typeof r.jitterBufferEmittedCount === "number"
    ) {
      const cur: JitterBufferCounter = {
        delay: r.jitterBufferDelay,
        count: r.jitterBufferEmittedCount,
      };
      const intervalMs = computeJitterBufferDelayMs(prev.get(r.id) ?? null, cur);
      if (
        intervalMs != null &&
        (result.intervalDelayMs == null || intervalMs > result.intervalDelayMs)
      ) {
        result.intervalDelayMs = intervalMs;
      }
      prev.set(r.id, cur);
    }
    if (typeof r.jitterBufferTargetDelay === "number") {
      const ms = r.jitterBufferTargetDelay * 1000;
      if (result.targetMs == null || ms > result.targetMs) result.targetMs = ms;
    }
    if (typeof r.jitterBufferMinimumDelay === "number") {
      const ms = r.jitterBufferMinimumDelay * 1000;
      if (result.minimumMs == null || ms > result.minimumMs)
        result.minimumMs = ms;
    }
  }
  return result;
}

const EMPTY: RtcStatsSnapshot = {
  rttMs: null,
  jitterMs: null,
  lossPct: null,
  jitterBufferDelayMs: null,
  jitterBufferTargetMs: null,
  jitterBufferMinimumMs: null,
  connectionState: "new",
  iceConnectionState: "new",
  updatedAt: 0,
};

let latest: RtcStatsSnapshot = { ...EMPTY };
let timer: number | null = null;
// 按统计条目 id 分别保存上一次抖动缓冲累计计数（多 track 不串扰）
const prevJitterBuffers = new Map<string, JitterBufferCounter>();

export function getLatestStats(): RtcStatsSnapshot {
  return latest;
}

export function startRtcStats(pc: RTCPeerConnection) {
  stopRtcStats();
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
  prevJitterBuffers.clear();
}

async function collect(pc: RTCPeerConnection) {
  try {
    const report = await pc.getStats();
    const next: RtcStatsSnapshot = {
      rttMs: latest.rttMs,
      jitterMs: latest.jitterMs,
      lossPct: latest.lossPct,
      jitterBufferDelayMs: latest.jitterBufferDelayMs,
      jitterBufferTargetMs: latest.jitterBufferTargetMs,
      jitterBufferMinimumMs: latest.jitterBufferMinimumMs,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    const inboundAudio: InboundAudioEntry[] = [];
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
        inboundAudio.push(r as InboundAudioEntry);
      }
    });
    const jb = computeJitterBufferStats(prevJitterBuffers, inboundAudio);
    // 某次采样缺失（区间内无新样本 / 字段不存在）时保留上一次的有效值
    if (jb.intervalDelayMs != null) next.jitterBufferDelayMs = jb.intervalDelayMs;
    if (jb.targetMs != null) next.jitterBufferTargetMs = jb.targetMs;
    if (jb.minimumMs != null) next.jitterBufferMinimumMs = jb.minimumMs;
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
      jitterBufferTargetMs:
        next.jitterBufferTargetMs != null
          ? Math.round(next.jitterBufferTargetMs)
          : null,
      jitterBufferMinimumMs:
        next.jitterBufferMinimumMs != null
          ? Math.round(next.jitterBufferMinimumMs)
          : null,
      connectionState: next.connectionState,
      iceConnectionState: next.iceConnectionState,
    });
  } catch {
    /* getStats 失败（如连接已关闭）时跳过本次 */
  }
}
