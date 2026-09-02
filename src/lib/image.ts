// 图片 -> base64 data URL，并压缩到 Mumble 消息长度限制以内。
// Mumble 图片消息以 <img src="data:image/...;base64,..."/> 形式内嵌在 HTML 消息里，
// 整条消息字符数受服务器 maximumMessageLength 限制，超出会被拒发。

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("读取文件失败"));
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

function scaleToDataUrl(
  img: HTMLImageElement,
  scale: number,
  type: "image/png" | "image/jpeg",
  quality?: number,
): string {
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

/**
 * 返回一个字符数不超过 charBudget 的 data URL。
 * 原图够小就直接用；否则逐级缩小尺寸，PNG 优先（保留透明），放不下再退 JPEG。
 */
export async function imageToMessageDataUrl(
  file: Blob,
  charBudget: number,
): Promise<string> {
  const original = await blobToDataUrl(file);
  if (original.length <= charBudget) return original;

  const img = await loadImage(original);
  for (const scale of [0.75, 0.5, 0.35, 0.25, 0.15, 0.1]) {
    const png = scaleToDataUrl(img, scale, "image/png");
    if (png.length <= charBudget) return png;
    const jpg = scaleToDataUrl(img, scale, "image/jpeg", 0.8);
    if (jpg.length <= charBudget) return jpg;
  }
  throw new Error("图片过大，压缩后仍超出服务器消息长度限制");
}
