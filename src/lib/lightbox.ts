export const LIGHTBOX_MIN_ZOOM = 0.05;
export const LIGHTBOX_MAX_ZOOM = 8;

export function clampZoom(zoom: number): number {
  return Math.min(
    LIGHTBOX_MAX_ZOOM,
    Math.max(LIGHTBOX_MIN_ZOOM, zoom),
  );
}

// 双指捏合：按两个触点距离的变化比例缩放，并夹在允许范围内。
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (startDistance <= 0 || !Number.isFinite(currentDistance)) {
    return clampZoom(startZoom);
  }
  return clampZoom(startZoom * (currentDistance / startDistance));
}

// 单指水平滑动：返回 1 = 下一张，-1 = 上一张，0 = 不切换。
export function swipeDirection(
  dx: number,
  dy: number,
  threshold = 60,
): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold) return 0;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
