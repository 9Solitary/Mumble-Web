import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logEvent } from "@/lib/diagnostics";
import i18n from "@/i18n";

// React 渲染错误兜底：记录诊断事件（react-error，全量上报），
// 显示深色风格的错误页 + 重载按钮。
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logEvent("react-error", {
      message: error.message,
      stack: error.stack?.slice(0, 200) ?? "",
      componentStack: info.componentStack?.slice(0, 200) ?? "",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-ink-950 flex flex-col items-center justify-center gap-4 text-fg-muted">
          <p className="text-lg text-fg">{i18n.t("errors.pageTitle")}</p>
          <p className="text-sm text-fg-muted">{i18n.t("errors.pageBody")}</p>
          <Button
            className="bg-mint hover:bg-mint-strong text-on-mint"
            onClick={() => window.location.reload()}
          >
            {i18n.t("errors.reload")}
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}
