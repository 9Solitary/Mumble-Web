import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// 声场暗色 Toast：底部居中，桌面位于语音卡上方，移动端避开 64px 语音坞。
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={16}
      mobileOffset={{ bottom: 80 }}
      closeButton={false}
      icons={{
        success: <CircleCheckIcon className="size-4" aria-hidden="true" />,
        info: <InfoIcon className="size-4" aria-hidden="true" />,
        warning: <TriangleAlertIcon className="size-4" aria-hidden="true" />,
        error: <OctagonXIcon className="size-4" aria-hidden="true" />,
        loading: <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />,
      }}
      style={
        {
          "--normal-bg": "rgb(var(--ink-800))",
          "--normal-text": "rgb(var(--fg))",
          "--normal-border": "rgb(var(--line-control))",
          "--success-bg": "rgb(var(--ink-800))",
          "--success-text": "rgb(var(--success))",
          "--success-border": "rgb(var(--success) / 0.35)",
          "--error-bg": "rgb(var(--ink-800))",
          "--error-text": "rgb(var(--danger-soft))",
          "--error-border": "rgb(var(--danger) / 0.35)",
          "--border-radius": "var(--radius-panel)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "!bg-ink-800 !text-fg !border-line-control !shadow-panel",
          title: "!text-ui !font-medium",
          description: "!text-caption !text-fg-muted",
          success: "!text-fg",
          error: "!text-fg",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
