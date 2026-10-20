import { cn } from "@/lib/utils";

// 说话指示：三条短竖条，颜色之外还有形状与动画，避免只靠颜色表达状态。
export function TalkingBars({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex h-3 shrink-0 items-end gap-0.5", className)}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="w-0.5 animate-eq rounded-full bg-mint"
          style={{
            height: index === 1 ? 10 : index === 0 ? 6 : 8,
            animationDelay: `${-0.2 - index * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
