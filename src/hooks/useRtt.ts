import { useEffect, useState } from "react";
import { getLatestStats } from "@/lib/rtcStats";

// 顶栏和语音坞共用：每秒读一次最新 RTT，不在 store 里新增网络状态。
export function useRtt(): number | null {
  const [rtt, setRtt] = useState<number | null>(() => getLatestStats().rttMs);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRtt(getLatestStats().rttMs);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return rtt;
}
