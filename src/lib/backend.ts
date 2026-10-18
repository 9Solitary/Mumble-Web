// 前后端分离部署支持：代理地址由运行时 config.js 注入（容器启动时按
// PROXY_ORIGIN 环境变量渲染），留空表示与前端同源（默认，行为与一体化部署一致）。
// 构建产物不绑定代理地址，迁移环境只需改容器环境变量。

declare global {
  interface Window {
    __PROXY_ORIGIN__?: string;
  }
}

function proxyOrigin(): string {
  const origin =
    typeof window !== "undefined" ? (window.__PROXY_ORIGIN__ ?? "") : "";
  // 去掉尾部斜杠，避免拼接出 //api/...
  return origin.replace(/\/+$/, "");
}

// apiUrl 返回 HTTP API 的完整地址；origin 为空时保持相对路径（同源）。
export function apiUrl(path: string): string {
  return proxyOrigin() + path;
}

// wsUrl 返回 WebSocket 完整地址；origin 为空时按当前页面协议推导（同源）。
export function wsUrl(path: string): string {
  const origin = proxyOrigin();
  if (origin) {
    return origin.replace(/^http/, "ws") + path;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}
