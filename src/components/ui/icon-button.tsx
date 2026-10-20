import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonSize = "sm" | "md" | "lg";

const sizeMap: Record<IconButtonSize, "icon-sm" | "icon" | "icon-lg"> = {
  sm: "icon-sm",
  md: "icon",
  lg: "icon-lg",
};

type IconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "size" | "aria-label"
> & {
  /** 必填：图标按钮没有可见文字，必须提供可访问名称。 */
  label: string;
  tooltip?: string;
  /** 只响应鼠标悬停，不在 focus 时打开；用于关闭弹窗后焦点归还的按钮。 */
  tooltipHoverOnly?: boolean;
  size?: IconButtonSize;
};

// 图标按钮统一出口：尺寸、焦点环、可访问名称和可选 tooltip 一次处理。
export function IconButton({
  label,
  tooltip,
  tooltipHoverOnly = false,
  size = "md",
  variant = "ghost",
  className,
  children,
  onClick,
  onPointerEnter,
  onPointerLeave,
  ...props
}: IconButtonProps) {
  const [hoverOpen, setHoverOpen] = React.useState(false);

  const button = (
    <Button
      aria-label={label}
      size={sizeMap[size]}
      variant={variant}
      className={cn("text-fg-muted hover:text-fg", className)}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  if (tooltipHoverOnly) {
    const hoverButton = (
      <Button
        aria-label={label}
        size={sizeMap[size]}
        variant={variant}
        className={cn("text-fg-muted hover:text-fg", className)}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          setHoverOpen(false);
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          setHoverOpen(true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          setHoverOpen(false);
        }}
      >
        {children}
      </Button>
    );

    return (
      <Tooltip
        open={hoverOpen}
        onOpenChange={(open) => {
          // 忽略 focus 触发的 open；只让 pointer 事件控制。
          if (!open) setHoverOpen(false);
        }}
      >
        <TooltipTrigger asChild>{hoverButton}</TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
