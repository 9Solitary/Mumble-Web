# ---------- 前端构建 ----------
FROM node:20-alpine AS frontend
WORKDIR /app
# 国内网络默认走 npmmirror（锁文件里的 resolved 地址一并重写，integrity 校验不受影响）；
# 海外构建可用 --build-arg NPM_REGISTRY_MIRROR= 置空跳过
ARG NPM_REGISTRY_MIRROR=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN if [ -n "$NPM_REGISTRY_MIRROR" ]; then \
      sed -i -e "s#https://registry.npmjs.org#$NPM_REGISTRY_MIRROR#g" package-lock.json && \
      npm config set registry "$NPM_REGISTRY_MIRROR"; \
    fi && \
    for i in 1 2 3; do npm ci --no-audit --no-fund && break || { echo "npm ci 失败，第 $i 次重试"; sleep 5; }; done
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.js postcss.config.js components.json ./
COPY src ./src
RUN npm run build

# ---------- 后端构建 ----------
FROM golang:1.24-alpine AS backend
WORKDIR /app
# 国内网络默认走 goproxy.cn；海外构建可用 --build-arg GOPROXY=https://proxy.golang.org,direct
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /proxy ./cmd/proxy

# ---------- 运行时 ----------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /proxy /app/proxy
COPY --from=frontend /app/dist /app/dist

ENV LISTEN=":8080" \
    STATIC_DIR="/app/dist" \
    MUMBLE_SERVER="localhost:64738" \
    MUMBLE_TLS="verify" \
    RTC_UDP_PORT="50000" \
    RTC_PUBLIC_IP=""

EXPOSE 8080/tcp 50000/udp
CMD ["/app/proxy"]
