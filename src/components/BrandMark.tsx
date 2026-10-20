import { cn } from "@/lib/utils";

// 品牌 mark：定稿位图（logo-bottom-left-swapped-token.png）的 owl-only alpha 版。
// 生产用 512 主图/多尺寸 PNG；S 版 SVG 仅作归档与 Safari pinned tab，不在这里使用。
export function BrandMark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[9px] border border-line-control bg-ink-900",
        className,
      )}
    >
      <img
        src="/brand/mark-owl-256.png"
        srcSet="/brand/mark-owl-64.png 1x, /brand/mark-owl-128.png 2x, /brand/mark-owl-256.png 3x"
        alt=""
        draggable={false}
        className={cn("size-6 select-none", markClassName)}
      />
    </span>
  );
}
