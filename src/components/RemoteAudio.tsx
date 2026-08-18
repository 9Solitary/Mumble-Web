import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";

// 为每个远端说话人的 MediaStream 渲染一个隐藏的 <audio>，
// 音量受成员列表中的滑块控制。
function AudioSink({ stream, volume }: { stream: MediaStream; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, volume);
  }, [volume]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

export function RemoteAudio() {
  const { remoteStreams, volumes } = useAppStore();
  return (
    <>
      {Object.entries(remoteStreams).map(([session, stream]) => (
        <AudioSink
          key={session}
          stream={stream}
          volume={volumes[Number(session)] ?? 1}
        />
      ))}
    </>
  );
}
