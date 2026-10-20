import { useCallback, useEffect, useState } from "react";

export const DEFAULT_DEVICE = "default"; // Radix Select 不允许空字符串 value

export function useAudioDevices(open: boolean) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [permissionNeeded, setPermissionNeeded] = useState(
    !navigator.mediaDevices?.enumerateDevices,
  );

  const load = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermissionNeeded(true);
      return;
    }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      // 未授权时 deviceId 为空，Radix Select 会直接抛错；这里过滤掉占位设备。
      const real = devs.filter(
        (d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
      );
      setInputs(real.filter((d) => d.kind === "audioinput"));
      setOutputs(real.filter((d) => d.kind === "audiooutput"));
      setPermissionNeeded(real.length === 0);
    } catch {
      setPermissionNeeded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // 设备枚举是外部系统订阅；枚举完成后才 setState，不属于同步渲染副作用。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, [open, load]);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await load();
    } catch {
      setPermissionNeeded(true);
    }
  }, [load]);

  return { inputs, outputs, permissionNeeded, requestPermission };
}

export function deviceLabel(device: MediaDeviceInfo, index: number, fallback: string): string {
  return device.label || fallback.replace("{{n}}", String(index + 1));
}
