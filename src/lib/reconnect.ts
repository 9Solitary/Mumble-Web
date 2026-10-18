// 重连退避计算器：指数退避（1s/2s/4s…封顶 30s）+ ±20% 随机抖动。
// 纯函数模块，rand 可注入便于测试。

export interface BackoffOptions {
  baseMs?: number; // 首次退避（默认 1000ms）
  maxMs?: number; // 封顶（默认 30000ms）
  factor?: number; // 增长因子（默认 2）
  jitter?: number; // 抖动幅度 0..1（默认 0.2，即 ±20%）
  rand?: () => number; // 随机源（默认 Math.random，测试可注入定值）
}

export interface Backoff {
  next(): number; // 返回本次退避毫秒数，并推进序列
  reset(): void; // 归零（重连成功后调用）
  attempts(): number; // 已产生的退避次数
}

export function createBackoff({
  baseMs = 1000,
  maxMs = 30000,
  factor = 2,
  jitter = 0.2,
  rand = Math.random,
}: BackoffOptions = {}): Backoff {
  let n = 0;
  return {
    next() {
      const base = Math.min(maxMs, baseMs * factor ** n);
      n++;
      // ±jitter 随机抖动：rand∈[0,1) 映射到 [1-jitter, 1+jitter)
      const jittered = base * (1 + (rand() * 2 - 1) * jitter);
      return Math.round(jittered);
    },
    reset() {
      n = 0;
    },
    attempts() {
      return n;
    },
  };
}
