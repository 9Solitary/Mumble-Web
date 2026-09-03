import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";

// 为每个远端说话人的 MediaStream 渲染一个隐藏的 <audio>，
// 音量受成员列表中的滑块控制，输出设备受设置页控制。
function AudioSink({
  stream,
  volume,
  sinkId,
}: {
  stream: MediaStream;
  volume: number;
  sinkId: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current
        .play()
        .then(() => console.log("[audio] 播放成功, tracks:", stream.getAudioTracks().length))
        .catch((e) => console.warn("[audio] 播放失败:", e));
    }
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, volume);
  }, [volume]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("sinkId" in HTMLMediaElement.prototype)) return;
    el.setSinkId(sinkId).catch((e) =>
      console.warn("[audio] setSinkId 失败:", e),
    );
  }, [sinkId]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

export function RemoteAudio() {
  const { remoteStreams, volumes, localMuted, outputDeviceId, outputVolume } =
    useAppStore();
  return (
    <>
      {Object.entries(remoteStreams).map(([session, stream]) => (
        <AudioSink
          key={session}
          stream={stream}
          volume={
            localMuted[Number(session)]
              ? 0
              : (volumes[Number(session)] ?? 1) * outputVolume
          }
          sinkId={outputDeviceId}
        />
      ))}
    </>
  );
}
