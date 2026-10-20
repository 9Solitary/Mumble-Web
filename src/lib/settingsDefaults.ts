// 设置页「恢复默认」使用的默认值。
// 这里只收口 UI 重置范围，不改变 appStore 的初始值与持久化逻辑。
export const DEFAULT_INPUT_DEVICE_ID = "";
export const DEFAULT_OUTPUT_DEVICE_ID = "";
export const DEFAULT_MIC_GAIN = 1;
export const DEFAULT_OUTPUT_VOLUME = 1;
export const DEFAULT_VAD_THRESHOLD = 0;
export const DEFAULT_CONTINUOUS_TRANSMIT = false;
export const DEFAULT_LOW_LATENCY_BUFFER = true;
export const DEFAULT_PTT_MODE = "open" as const;
