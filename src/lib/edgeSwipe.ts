export type EdgeSwipeTarget = "channels" | "members" | null;

// 从屏幕左/右边缘开始的水平滑动：左缘向右 = 频道，右缘向左 = 成员。
// 垂直位移过大、距离不够或起点不在边缘时都不触发。
export function detectEdgeSwipe({
  startX,
  startY,
  endX,
  endY,
  width,
  edge = 24,
  threshold = 56,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  edge?: number;
  threshold?: number;
}): EdgeSwipeTarget {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;

  if (startX <= edge && dx > 0) return "channels";
  if (startX >= width - edge && dx < 0) return "members";
  return null;
}
