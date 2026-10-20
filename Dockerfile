# ---------- 代理镜像（纯 Go，不含前端；前端见 Dockerfile.web） ----------
FROM golang:1.24-alpine AS backend
WORKDIR /app
# 国内网络默认走 goproxy.cn；海外构建可用 --build-arg GOPROXY=https://proxy.golang.org,direct
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# .git 被 .dockerignore 排除，构建上下文内取不到 git sha，
# 由宿主机构建时传入：docker compose build --build-arg ... 或 VERSION=$(git rev-parse --short HEAD)
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /proxy ./cmd/proxy

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /proxy /app/proxy
# 许可证与第三方声明随二进制镜像分发（MPL/BSD 合规）
COPY THIRD_PARTY_NOTICES.md /app/licenses/THIRD_PARTY_NOTICES.md
COPY THIRD_PARTY_LICENSES/ /app/licenses/THIRD_PARTY_LICENSES/

ENV LISTEN=":8080" \
    MUMBLE_SERVER="localhost:64738" \
    MUMBLE_TLS="verify" \
    RTC_UDP_PORT="50000" \
    RTC_PUBLIC_IP=""

EXPOSE 8080/tcp 50000/udp
CMD ["/app/proxy"]
