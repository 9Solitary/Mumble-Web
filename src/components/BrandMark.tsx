import { cn } from "@/lib/utils";

// 品牌 mark：圆角方底 + 四根波形竖条，16px 下仍可辨认。
// 与 public/favicon.svg 保持同一造型，改这里时同步改 favicon。
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-control bg-ink-900",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5 text-mint" fill="none">
        <rect x="3.4" y="9" width="2.6" height="6" rx="1.3" fill="currentColor" />
        <rect x="7.7" y="5" width="2.6" height="14" rx="1.3" fill="currentColor" />
        <rect
          x="12"
          y="7.4"
          width="2.6"
          height="9.2"
          rx="1.3"
          className="text-mint-strong"
          fill="currentColor"
        />
        <rect
          x="16.3"
          y="10"
          width="2.6"
          height="4"
          rx="1.3"
          fill="currentColor"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}
