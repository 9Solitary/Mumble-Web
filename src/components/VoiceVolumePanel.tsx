import type { ReactNode } from "react";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// 一个按钮对应一个横向滑条：不加设备下拉、不加第二行、不增加常驻按钮。
// 面板固定 224×44，中心对齐触发按钮；窄屏由 max-w 兜底，不改变结构。
export function VoiceVolumePanel({
  open,
  label,
  value,
  max,
  onChange,
  icon,
  testId,
}: {
  open: boolean;
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  icon: ReactNode;
  testId?: string;
}) {
  const percent = Math.round(value * 100);

  return (
    <div
      className={cn(
        "absolute bottom-full left-1/2 z-50 w-56 max-w-[calc(100vw-1rem)] -translate-x-1/2 pb-2",
        open ? "block" : "hidden",
      )}
    >
      <div
        data-testid={testId}
        className="relative flex h-11 items-center gap-2 rounded-panel border border-line-control bg-ink-800 px-3 shadow-panel"
      >
        <span className="shrink-0 text-fg-subtle" aria-hidden="true">
          {icon}
        </span>
        <Slider
          compact
          className="min-w-0 flex-1"
          aria-label={label}
          value={[value * 100]}
          min={0}
          max={max * 100}
          step={1}
          onValueChange={([v]) => onChange(v / 100)}
        />
        <span
          aria-hidden="true"
          className={cn(
            "w-9 shrink-0 text-right font-mono text-data tabular-nums",
            value === 0 ? "text-danger" : "text-fg-muted",
          )}
        >
          {percent}%
        </span>
        <span
          aria-hidden="true"
          className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-b border-r border-line-control bg-ink-800"
        />
      </div>
    </div>
  );
}
