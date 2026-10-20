import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clampZoom,
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  pinchZoom,
  swipeDirection,
} from "@/lib/lightbox";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";

const ZOOM_STEP = 1.25;

function fitFor(naturalW: number, naturalH: number): number {
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.76;
  const fit = Math.min(maxW / naturalW, maxH / naturalH);
  // 小图自动放大（最多 4 倍），避免点开后和缩略图一样大。
  return clampZoom(Math.min(fit, 4));
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
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const swipeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const didGestureRef = useRef(false);

  const current = images[index] ?? "";
  const total = images.length;

  const go = useCallback(
    (delta: number) => {
      if (total < 2) return;
      setZoom(1);
      setFitZoom(1);
      setNatural(null);
      setFailed(false);
      pointersRef.current.clear();
      pinchRef.current = null;
      swipeRef.current = null;
      panRef.current = null;
      setPanning(false);
      onIndexChange((index + delta + total) % total);
    },
    [index, onIndexChange, total],
  );

  const zoomBy = useCallback((factor: number) => {
    setZoom((value) => clampZoom(value * factor));
  }, []);

  const download = useCallback(() => {
    if (!current) return;
    const anchor = document.createElement("a");
    anchor.href = current;
    anchor.download = filenameFor(current, index);
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
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
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-delta * 0.003)));
      setZoom((value) => clampZoom(value * factor));
    };
    const targets: HTMLElement[] = [];
    if (viewportRef.current) targets.push(viewportRef.current);
    if (imageRef.current) targets.push(imageRef.current);
    targets.forEach((el) =>
      el.addEventListener("wheel", onWheel, { passive: false }),
    );
    return () =>
      targets.forEach((el) => el.removeEventListener("wheel", onWheel));
  }, [natural]);

  const releasePointer = (pointerId: number) => {
    const el = viewportRef.current;
    if (el?.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>, allowSwipe: boolean) => {
    const wasPinching = pinchRef.current != null;
    const swipe =
      swipeRef.current?.pointerId === e.pointerId ? swipeRef.current : null;
    const wasPanning = panRef.current != null;

    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    swipeRef.current = null;
    panRef.current = null;
    setPanning(false);
    releasePointer(e.pointerId);

    if (
      allowSwipe &&
      swipe &&
      !wasPinching &&
      !wasPanning &&
      !didGestureRef.current
    ) {
      const direction = swipeDirection(e.clientX - swipe.x, e.clientY - swipe.y);
      if (direction !== 0) {
        didGestureRef.current = true;
        go(direction);
      }
    }
  };

  const canPan = !!natural && zoom > fitZoom + 0.001;

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
          {/* 顶栏：移动端隐藏非核心按钮，保留 44px 触控目标 */}
          <div className="flex h-14 shrink-0 items-center gap-2 px-2 sm:px-3">
            <span
              data-testid="lightbox-counter"
              className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted"
            >
              {total > 1 ? t("lightbox.counter", { index: index + 1, total }) : ""}
            </span>
            <div
              data-testid="lightbox-toolbar"
              className="flex shrink-0 items-center gap-1"
            >
              <button
                type="button"
                onClick={() => zoomBy(1 / ZOOM_STEP)}
                disabled={zoom <= LIGHTBOX_MIN_ZOOM + 0.001}
                aria-label={t("lightbox.zoomOut")}
                className="grid size-11 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg disabled:opacity-30 sm:size-9"
              >
                <Minus className="size-4" />
              </button>
              <span className="min-w-10 text-center font-mono text-[11px] text-fg-muted sm:text-xs">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={zoom >= LIGHTBOX_MAX_ZOOM - 0.001}
                aria-label={t("lightbox.zoomIn")}
                className="grid size-11 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg disabled:opacity-30 sm:size-9"
              >
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label={t("lightbox.actualSize")}
                className="hidden h-9 rounded-md px-2 font-mono text-xs text-fg-muted hover:bg-fg/10 hover:text-fg sm:block"
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => setZoom(fitZoom)}
                aria-label={t("lightbox.fit")}
                title={t("lightbox.fit")}
                className="grid size-11 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg sm:flex sm:h-9 sm:w-auto sm:px-2"
              >
                <Maximize2 className="size-4 sm:hidden" />
                <span className="hidden text-xs sm:inline">
                  {t("lightbox.fit")}
                </span>
              </button>
              <span className="mx-1 hidden h-5 w-px bg-fg/15 sm:block" />
              <button
                type="button"
                onClick={openInTab}
                aria-label={t("lightbox.openTab")}
                className="hidden size-9 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg sm:grid"
              >
                <ExternalLink className="size-4" />
              </button>
              <button
                type="button"
                onClick={download}
                data-testid="lightbox-download"
                aria-label={t("lightbox.download")}
                className="grid size-11 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg sm:size-9"
              >
                <Download className="size-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("lightbox.close")}
                className="ml-0.5 grid size-11 place-items-center rounded-md text-fg-muted hover:bg-fg/10 hover:text-fg sm:size-9"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* 图片：滚轮/双指缩放、放大后拖拽平移、适应时左右滑动切换 */}
          <div
            ref={viewportRef}
            data-testid="lightbox-viewport"
            className={`relative grid min-h-0 flex-1 touch-none place-items-center overflow-auto p-4 ${
              panning ? "cursor-grabbing" : canPan ? "cursor-grab" : ""
            }`}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              // 只接管图片和空白画布上的手势，工具栏/翻页按钮上的点击不参与拖拽。
              if (
                e.target !== e.currentTarget &&
                e.target !== imageRef.current
              ) {
                return;
              }
              pointersRef.current.set(e.pointerId, {
                x: e.clientX,
                y: e.clientY,
              });

              if (pointersRef.current.size === 2) {
                const [first, second] = [...pointersRef.current.values()];
                const distance = Math.hypot(
                  first.x - second.x,
                  first.y - second.y,
                );
                if (distance > 0) {
                  pinchRef.current = { distance, zoom };
                }
                didGestureRef.current = true;
                swipeRef.current = null;
                panRef.current = null;
                setPanning(false);
                return;
              }
              if (pointersRef.current.size > 2) return;

              const el = viewportRef.current;
              if (!el) return;
              // 留 2px 容忍亚像素取整；否则“适应屏幕”后会误判为可拖拽。
              const fits =
                el.scrollWidth <= el.clientWidth + 2 &&
                el.scrollHeight <= el.clientHeight + 2;
              if (!fits) {
                didGestureRef.current = false;
                panRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: el.scrollLeft,
                  top: el.scrollTop,
                };
                el.setPointerCapture(e.pointerId);
                setPanning(true);
              } else if (e.pointerType !== "mouse") {
                didGestureRef.current = false;
                swipeRef.current = {
                  pointerId: e.pointerId,
                  x: e.clientX,
                  y: e.clientY,
                };
              } else {
                didGestureRef.current = false;
              }
            }}
            onPointerMove={(e) => {
              const point = pointersRef.current.get(e.pointerId);
              if (point) {
                point.x = e.clientX;
                point.y = e.clientY;
              }

              if (pointersRef.current.size >= 2 && pinchRef.current) {
                const [first, second] = [...pointersRef.current.values()];
                const distance = Math.hypot(
                  first.x - second.x,
                  first.y - second.y,
                );
                setZoom(
                  pinchZoom(
                    pinchRef.current.zoom,
                    pinchRef.current.distance,
                    distance,
                  ),
                );
                didGestureRef.current = true;
                return;
              }

              const el = viewportRef.current;
              const start = panRef.current;
              if (!el || !start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) + Math.abs(dy) > 2) {
                didGestureRef.current = true;
              }
              el.scrollLeft = start.left - dx;
              el.scrollTop = start.top - dy;
            }}
            onPointerUp={(e) => endGesture(e, true)}
            onPointerCancel={(e) => endGesture(e, false)}
            onClick={(e) => {
              if (didGestureRef.current) {
                didGestureRef.current = false;
                return;
              }
              if (e.target === e.currentTarget) onClose();
            }}
          >
            {failed ? (
              <p role="alert" className="text-sm text-fg-muted">
                {t("lightbox.loadFailed")}
              </p>
            ) : (
              <img
                ref={imageRef}
                data-testid="lightbox-image"
                src={current}
                alt={t("lightbox.title")}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={() =>
                  setZoom((currentZoom) =>
                    currentZoom > fitZoom * 1.01
                      ? fitZoom
                      : clampZoom(fitZoom * 2),
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
                  className="absolute left-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-overlay/50 text-fg hover:bg-overlay/70 sm:left-3 sm:size-10"
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
                  className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-overlay/50 text-fg hover:bg-overlay/70 sm:right-3 sm:size-10"
                >
                  <ChevronRight className="size-6" />
                </button>
              </>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2">
              <span className="rounded-full bg-overlay/45 px-3 py-1 text-center text-[10.5px] text-fg/55">
                <span className="sm:hidden">{t("lightbox.hintTouch")}</span>
                <span className="hidden sm:inline">{t("lightbox.hint")}</span>
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
