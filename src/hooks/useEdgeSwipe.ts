import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { detectEdgeSwipe } from "@/lib/edgeSwipe";

const IGNORE_SELECTOR =
  "button, a, input, textarea, select, [role='button'], [role='menuitem']";

// 触摸边缘手势：左缘右滑开频道抽屉，右缘左滑开成员抽屉。
// 只接管 touch 指针，且不抢按钮/输入框上的点击。
export function useEdgeSwipe({
  onOpenChannels,
  onOpenMembers,
  disabled = false,
}: {
  onOpenChannels: () => void;
  onOpenMembers: () => void;
  disabled?: boolean;
}) {
  const startRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.pointerType !== "touch") return;
    const target = e.target as Element | null;
    if (target?.closest(IGNORE_SELECTOR)) return;
    startRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || disabled || e.pointerType !== "touch") return;
    if (start.pointerId !== e.pointerId) return;

    const target = detectEdgeSwipe({
      startX: start.x,
      startY: start.y,
      endX: e.clientX,
      endY: e.clientY,
      width: window.innerWidth,
    });
    if (target === "channels" && window.innerWidth < 768) {
      onOpenChannels();
    } else if (target === "members" && window.innerWidth < 1180) {
      onOpenMembers();
    }
  };

  const onPointerCancel = () => {
    startRef.current = null;
  };

  return { onPointerDown, onPointerUp, onPointerCancel };
}
