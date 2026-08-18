# ---------- 前端构建 ----------
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tailwind.config.js postcss.config.js components.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------- 后端构建 ----------
FROM golang:1.23-alpine AS backend
WORKDIR /app
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
    MUMBLE_SERVER="voice.azsyc.com" \
    MUMBLE_TLS="pin:BC:3C:29:BC:A9:C7:C4:73:95:90:E8:B0:4A:65:14:E1:E8:8C:30:F3:BA:94:AB:8B:26:B4:8A:6D:B7:AE:4D:CF" \
    RTC_UDP_PORT="50000" \
    RTC_PUBLIC_IP=""

EXPOSE 8080/tcp 50000/udp
CMD ["/app/proxy"]
