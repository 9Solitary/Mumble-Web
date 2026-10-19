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
  size?: IconButtonSize;
};

// 图标按钮统一出口：尺寸、焦点环、可访问名称和可选 tooltip 一次处理。
export function IconButton({
  label,
  tooltip,
  size = "md",
  variant = "ghost",
  className,
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      aria-label={label}
      size={sizeMap[size]}
      variant={variant}
      className={cn("text-fg-muted hover:text-fg", className)}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
