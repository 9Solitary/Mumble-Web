import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Minus, Plus, X } from "lucide-react";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitFor(naturalW: number, naturalH: number): number {
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.76;
  const fit = Math.min(maxW / naturalW, maxH / naturalH);
  // 小图自动放大（最多 4 倍），避免点开后和缩略图一样大。
  return clamp(fit, MIN_ZOOM, 4);
}

function filenameFor(src: string, index: number): string {
  const mime = /^data:image\/([a-z0-9.+-]+);/i.exec(src)?.[1]?.toLowerCase() ?? "png";
  const ext =
    mime === "jpeg" ? "jpg" : mime === "svg+xml" ? "svg" : mime.replace(/[^a-z0-9]/g, "");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `mumble-${stamp}-${index + 1}.${ext || "png"}`;
}

export function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const didPanRef = useRef(false);

  const current = images[index] ?? "";
  const total = images.length;

  const go = useCallback(
    (delta: number) => {
      if (total < 2) return;
      setZoom(1);
      setFitZoom(1);
      setNatural(null);
      setFailed(false);
      onIndexChange((index + delta + total) % total);
    },
    [index, onIndexChange, total],
  );

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const download = useCallback(() => {
    if (!current) return;
    const a = document.createElement("a");
    a.href = current;
    a.download = filenameFor(current, index);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [current, index]);

  const openInTab = useCallback(() => {
    if (!current) return;
    const opened = window.open(current, "_blank", "noopener,noreferrer");
    if (!opened) download(); // 弹窗被拦截时降级为下载
  }, [current, download]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (e.key === "0") {
        setZoom(fitZoom);
      } else if (e.key === "ArrowLeft") {
        go(-1);
      } else if (e.key === "ArrowRight") {
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitZoom, go, zoomBy]);

  // 滚轮缩放：必须用非 passive 监听才能 preventDefault，避免整页滚动。
  // 容器和图片各挂一份并检查 defaultPrevented，避免某些浏览器把事件只送到图片节点。
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const delta = e.deltaY * unit;
      if (!delta) return;
      const factor = clamp(Math.exp(-delta * 0.003), 0.8, 1.25);
      setZoom((z) => clamp(z * factor, MIN_ZOOM, MAX_ZOOM));
    };
    const targets: HTMLElement[] = [];
    if (viewportRef.current) targets.push(viewportRef.current);
    if (imageRef.current) targets.push(imageRef.current);
    targets.forEach((el) => el.addEventListener("wheel", onWheel, { passive: false }));
    return () => targets.forEach((el) => el.removeEventListener("wheel", onWheel));
  }, [natural]);

  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    panRef.current = null;
    setPanning(false);
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const canPan = !!natural;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="lightbox-dialog max-h-none max-w-none gap-0 rounded-none border-0 bg-transparent p-0 text-fg shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{t("lightbox.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("lightbox.counter", { index: index + 1, total })}
        </DialogDescription>

        <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col bg-overlay">
          {/* 顶栏 */}
          <div className="flex h-14 shrink-0 items-center gap-2 px-3">
            <span className="min-w-0 truncate font-mono text-xs text-fg-muted">
              {total > 1 ? t("lightbox.counter", { index: index + 1, total }) : ""}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM + 0.001}
                aria-label={t("lightbox.zoomOut")}
                className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg disabled:opacity-30"
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-12 text-center font-mono text-xs text-fg-muted">
                {zoomLabel}
              </span>
              <button
                type="button"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM - 0.001}
                aria-label={t("lightbox.zoomIn")}
                className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg disabled:opacity-30"
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label={t("lightbox.actualSize")}
                className="h-9 rounded-md px-2 font-mono text-xs text-fg-muted hover:bg-fg/10 hover:text-fg"
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => setZoom(fitZoom)}
                aria-label={t("lightbox.fit")}
                className="h-9 rounded-md px-2 text-xs text-fg-muted hover:bg-fg/10 hover:text-fg"
              >
                {t("lightbox.fit")}
              </button>
              <span className="mx-1 h-5 w-px bg-fg/15" />
              <button
                type="button"
                onClick={openInTab}
                aria-label={t("lightbox.openTab")}
                className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg"
              >
                <ExternalLink className="size-4" />
              </button>
              <button
                type="button"
                onClick={download}
                aria-label={t("lightbox.download")}
                className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg"
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("lightbox.close")}
                className="ml-1 grid size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* 图片：滚轮缩放、放大后拖拽平移 */}
          <div
            ref={viewportRef}
            className={`relative grid min-h-0 flex-1 place-items-center overflow-auto p-4 ${
              panning ? "cursor-grabbing" : canPan ? "cursor-grab" : ""
            }`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const el = viewportRef.current;
              if (!el) return;
              if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
              didPanRef.current = false;
              panRef.current = {
                x: e.clientX,
                y: e.clientY,
                left: el.scrollLeft,
                top: el.scrollTop,
              };
              el.setPointerCapture(e.pointerId);
              setPanning(true);
            }}
            onPointerMove={(e) => {
              const el = viewportRef.current;
              const start = panRef.current;
              if (!el || !start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 2) didPanRef.current = true;
              el.scrollLeft = start.left - dx;
              el.scrollTop = start.top - dy;
            }}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onClick={(e) => {
              if (didPanRef.current) {
                didPanRef.current = false;
                return;
              }
              if (e.target === e.currentTarget) onClose();
            }}
          >
            {failed ? (
              <p className="text-sm text-fg-muted">{t("lightbox.loadFailed")}</p>
            ) : (
              <img
                ref={imageRef}
                src={current}
                alt={t("lightbox.title")}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={() =>
                  setZoom((currentZoom) =>
                    currentZoom > fitZoom * 1.01
                      ? fitZoom
                      : clamp(fitZoom * 2, MIN_ZOOM, MAX_ZOOM),
                  )
                }
                onLoad={(e) => {
                  const img = e.currentTarget;
                  const nat = { w: img.naturalWidth, h: img.naturalHeight };
                  const fitted = fitFor(nat.w, nat.h);
                  setNatural(nat);
                  setFitZoom(fitted);
                  setZoom(fitted);
                }}
                onError={() => setFailed(true)}
                draggable={false}
                className="max-h-none max-w-none select-none object-contain"
                style={
                  natural
                    ? { width: natural.w * zoom, height: natural.h * zoom }
                    : { maxWidth: "92vw", maxHeight: "76vh" }
                }
              />
            )}

            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                  aria-label={t("lightbox.previous")}
                  className="absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-overlay/50 text-fg hover:bg-overlay/70"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                  aria-label={t("lightbox.next")}
                  className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-overlay/50 text-fg hover:bg-overlay/70"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className="rounded-full bg-overlay/45 px-3 py-1 text-[10.5px] text-fg/55">
                {t("lightbox.hint")}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
