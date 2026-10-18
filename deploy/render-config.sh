#!/bin/sh
# 容器启动时按 PROXY_ORIGIN 渲染前端运行时配置；留空 = 前端与代理同源。
# 由 nginx 官方镜像的 /docker-entrypoint.d 机制在启动 nginx 前执行。
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.__PROXY_ORIGIN__ = "${PROXY_ORIGIN:-}";
EOF
