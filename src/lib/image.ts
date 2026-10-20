// 图片 -> base64 data URL，并压缩到 Mumble 消息长度限制以内。
// Mumble 图片消息以 <img src="data:image/...;base64,..."/> 形式内嵌在 HTML 消息里，
// 整条消息字符数受服务器 maximumMessageLength 限制，超出会被拒发。
//
// 压缩策略：不要用粗粒度缩放档位直接“掉一档”，而是在预算内尽量保留分辨率：
// - 原始文件已够小：原样发送（保留格式/透明/动画）；
// - 否则先尝试最大边 4096 的无损 PNG；
// - 再用 JPEG q0.72 做二分搜索，找到预算内最大的尺寸；
// - 在该尺寸上优先无损 PNG，其次尝试 q0.86/q0.79，最后回退 q0.72。
// 这样同样 131k 字符预算下，2400×1600 的图通常能保留 1300px 左右，而不是 840px。

const MAX_EDGE = 4096;
const SEARCH_QUALITY = 0.72;
const MAX_QUALITY = 0.86;
const FALLBACK_QUALITY = 0.79;
const MIN_QUALITY = 0.6;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("image_read_failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = src;
  });
}

function scaleToDataUrl(
  img: HTMLImageElement,
  scale: number,
  type: "image/png" | "image/jpeg",
  quality?: number,
): string {
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  // JPEG 不支持透明；先铺白底，避免透明 PNG 回退成黑底。
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL(type, quality);
}

function chooseLargestJpegScale(
  img: HTMLImageElement,
  charBudget: number,
  maxScale: number,
): { scale: number; data: string } | null {
  let low = Math.min(0.05, maxScale);
  let high = maxScale;
  let best: { scale: number; data: string } | null = null;

  // JPEG 体积随尺寸单调增加，二分比逐档尝试快，也不会漏掉中间尺寸。
  for (let index = 0; index < 8; index += 1) {
    const scale = (low + high) / 2;
    const data = scaleToDataUrl(img, scale, "image/jpeg", SEARCH_QUALITY);
    if (data.length <= charBudget) {
      best = { scale, data };
      low = scale;
    } else {
      high = scale;
    }
  }
  return best;
}

/**
 * 返回一个字符数不超过 charBudget 的 data URL。
 * 原图够小就直接用；否则在预算内尽量保留更大的分辨率。
 */
export async function imageToMessageDataUrl(
  file: Blob,
  charBudget: number,
): Promise<string> {
  const original = await blobToDataUrl(file);
  if (original.length <= charBudget) return original;

  const img = await loadImage(original);
  const longestEdge = Math.max(img.naturalWidth, img.naturalHeight);
  if (!longestEdge) throw new Error("image_decode_failed");
  const maxScale = Math.min(1, MAX_EDGE / longestEdge);

  // 先试最大尺寸的无损 PNG：简单图标/截图在不超预算时保持无损。
  const maxPng = scaleToDataUrl(img, maxScale, "image/png");
  if (maxPng.length <= charBudget) return maxPng;

  const best = chooseLargestJpegScale(img, charBudget, maxScale);
  if (!best) {
    // 极端情况下连最小搜索尺寸都放不下：用最低质量再兜底一次。
    const fallback = scaleToDataUrl(
      img,
      Math.min(0.05, maxScale),
      "image/jpeg",
      MIN_QUALITY,
    );
    if (fallback.length <= charBudget) return fallback;
    throw new Error("image_too_large");
  }

  // 同一尺寸下，无损 PNG 可能仍然放得下（例如颜色简单的图）。
  const png = scaleToDataUrl(img, best.scale, "image/png");
  if (png.length <= charBudget) return png;

  // 在最大可行尺寸上尽量提高质量。
  for (const quality of [MAX_QUALITY, FALLBACK_QUALITY]) {
    const higher = scaleToDataUrl(
      img,
      best.scale,
      "image/jpeg",
      quality,
    );
    if (higher.length <= charBudget) return higher;
  }
  return best.data;
}
