# Mumble Web 部署与维护手册

本手册面向在任何普通开发机/服务器上独立部署本项目，不依赖原始开发环境。

---

## 1. 环境要求

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Docker | ≥ 20.10 | 构建镜像与运行容器 |
| Docker Compose | ≥ v2.0（`docker compose` 子命令） | 编排启动 |
| Git | 任意 | 仅用于拉取/更新代码 |
| 其他宿主机依赖 | 无 | 前端与 Go 代理均在容器内构建 |

网络要求：

- 容器使用 **host 网络模式**：需要能访问上游 Mumble 服务器（地址在 `.env` 的 `MUMBLE_SERVER` 配置，默认端口 64738）
- 浏览器需要能访问**宿主机**的 **HTTP 端口（默认 8080）** 和 **UDP 50000（WebRTC 语音）**
- 公网正式使用建议在前面加一层 HTTPS 反向代理（浏览器要求安全上下文才授予麦克风权限）

> 为什么用 host 网络：WebRTC 语音依赖 UDP，docker 的端口映射（docker-proxy/NAT）
> 在部分平台（如 WSL2）不转发 UDP，会导致浏览器↔代理的 ICE 连通性检查失败、
> 语音双向不通。host 模式下端口由 `PORT` / `RTC_UDP_PORT` 环境变量直接决定。

---

## 2. 第一次部署

```bash
# 1. 拉取代码
git clone <你的私有仓库地址> mumble-web
cd mumble-web

# 2. 配置环境变量（编辑 .env，填入上游 Mumble 服务器地址与 TLS 策略）
cp .env.example .env

# 3. 构建并启动
docker compose up -d

# 4. 验证
docker compose ps          # 状态应为 running (healthy)
docker compose logs -f     # 观察启动日志，Ctrl+C 退出
```

> Dockerfile 默认使用国内加速源构建（`GOPROXY=https://goproxy.cn,direct`、`NPM_REGISTRY_MIRROR=https://registry.npmmirror.com`）。
> 海外网络构建可覆盖：`docker compose build --build-arg GOPROXY=https://proxy.golang.org,direct --build-arg NPM_REGISTRY_MIRROR=`。

启动日志为 JSON 格式（每行一条），应看到：

```json
{"ts":"...","level":"INFO","msg":"proxy_start","event":"proxy_start","version":"<git sha 或 dev>"}
{"ts":"...","level":"INFO","msg":"upstream_resolved","event":"upstream_resolved","original":"...","address":"host:port","tls":"verify","sni":"..."}
{"ts":"...","level":"INFO","msg":"rtc_udp_ready","event":"rtc_udp_ready","port":50000}
{"ts":"...","level":"INFO","msg":"http_listen","event":"http_listen","listen":":8080"}
```

浏览器访问 `http://<服务器地址>:8080`，输入用户名和 Mumble 服务器密码即可使用。

> 邀请链接功能：在 `.env` 中配置 `INVITE_SECRET` 后，机器人后端可通过
> `POST /api/invites`（与静态页同源，无需额外端口）生成一次性邀请链接，
> API 契约见 [README.md](README.md)「邀请链接 / Bot 对接」一节。

---

## 3. 日常操作

```bash
docker compose up -d              # 启动
docker compose down               # 停止并删除容器
docker compose restart            # 重启
docker compose logs -f            # 跟踪日志
docker compose ps                 # 查看容器状态

# 更新代码并重建
git pull
docker compose up -d --build
```

---

## 4. 数据与持久化

**本项目基本无状态：**

- 没有数据库；每个浏览器会话是一个独立的 Mumble 登录，状态仅存于内存
- 删除容器不会丢失任何数据（聊天记录不落盘，刷新页面即重新同步）
- 需要保留的只有 `.env` 配置文件本身

唯一的落盘文件是**诊断上报**：`./diag/diag.jsonl`（前端错误/断线事件，用于排查问题）。

- 每行一个事件，含 `sid`（会话标识）、`version`（构建版本）、`kind`、`data`、`recv_ts`
- 隐私红线：不含聊天内容、密码、用户名、邀请 token（前端上报前已脱敏）
- 建议保留 7 天后清理；compose 已配置容器日志轮转（json-file，10MB×5）

---

## 5. 配置与 Secret

- 所有配置通过 `.env` 注入（模板见 `.env.example`），`.env` 已被 `.gitignore` 排除
- 项目内**没有任何**需要提交的密钥：Mumble 服务器密码由最终用户在网页登录框输入，不经过配置文件
- `MUMBLE_TLS` 的指纹是公开信息（任何人连接服务器都能获取），不属于 Secret

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MUMBLE_SERVER` | `localhost:64738` | 上游服务器；无端口自动 SRV 解析 |
| `MUMBLE_TLS` | `verify` | `verify` / `pin:<sha256>` / `insecure` |
| `PORT` | `8080` | 对外 HTTP 端口 |
| `RTC_UDP_PORT` | `50000` | WebRTC UDP 端口 |
| `RTC_PUBLIC_IP` | 空 | 代理在 NAT 后时填公网 IP |
| `ALLOW_SERVER_OVERRIDE` | `true` | 允许网页端连接页自选上游服务器（`false` 锁定为 `MUMBLE_SERVER`） |

---

## 6. HTTPS 与公网部署（建议）

浏览器只在安全上下文（HTTPS 或 localhost）下允许麦克风。公网部署示例（Caddy）：

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy 会自动处理 WebSocket 升级与证书。UDP 50000 不经过反代，直接对公网放行。

### 反向代理的 WebSocket 长连接配置

代理服务端每 25s 向浏览器发一次 WS Ping 控制帧（浏览器自动回 Pong，前端无需改代码），
因此反代/网关的空闲超时**不低于 60s 即可**，但建议放宽到 1 小时以减少干扰：

```nginx
# nginx 示例
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # WS 长连接读超时，低于 60s 会掐断心跳间隙
    proxy_send_timeout 3600s;
}
```

注意：

- **Cloudflare**：免费/Pro 档 WS 空闲超时约 100s，不可调；服务端 25s 心跳可保活，无需额外配置。
  若仍见 100s 左右规律断线，检查是否经过了其他不感知 WS 控制帧的中间层。
- 任何把 `proxy_read_timeout` 调到 25s 以下的配置都会掐死空闲连接——心跳间隔是 25s。

---

## 7. 常见问题

**页面能打开但提示「WebSocket 被阻断」**
→ 中间存在不支持 WebSocket 的代理/网关。直连容器端口，或使用支持 WS 升级的反代（Caddy/Nginx 均支持）。

**能登录、能聊天，但听不到别人说话**
→ 检查 UDP 50000 是否对浏览器可达（云服务器安全组常漏放 UDP）；代理在 NAT 后时设置 `RTC_PUBLIC_IP`。

**登录提示证书相关错误**
→ 服务器证书续期后指纹会变，更新 `.env` 中 `MUMBLE_TLS` 的 pin 指纹，或直接改为 `verify` 后 `docker compose up -d`。

**想换 Mumble 服务器**
→ 修改 `.env` 的 `MUMBLE_SERVER`，重启即可，无需改代码。
