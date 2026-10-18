import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { logEvent } from "@/lib/diagnostics";

// React 渲染错误兜底：记录诊断事件（react-error，全量上报），
// 显示深色风格的错误页 + 重载按钮
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
        <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center gap-4 text-[#b5bac1]">
          <p className="text-lg text-white">页面出现错误</p>
          <p className="text-sm text-[#949ba4]">
            错误已记录，重载页面可重试
          </p>
          <Button
            className="bg-[#5865f2] hover:bg-[#4752c4] text-white"
            onClick={() => window.location.reload()}
          >
            重新加载
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
