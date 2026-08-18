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

- 容器需要能访问上游 Mumble 服务器（默认 `voice.azsyc.com`，TCP 64738）
- 浏览器需要能访问容器的 **HTTP 端口（默认 8080）** 和 **UDP 50000（WebRTC 语音）**
- 公网正式使用建议在前面加一层 HTTPS 反向代理（浏览器要求安全上下文才授予麦克风权限）

---

## 2. 第一次部署

```bash
# 1. 拉取代码
git clone <你的私有仓库地址> mumble-web
cd mumble-web

# 2. 配置环境变量（默认值即可直连 voice.azsyc.com，按需修改）
cp .env.example .env

# 3. 构建并启动
docker compose up -d

# 4. 验证
docker compose ps          # 状态应为 running (healthy)
docker compose logs -f     # 观察启动日志，Ctrl+C 退出
```

启动日志中应看到：

```
上游 Mumble: voice.azsyc.com -> tencent.azsyc.com:64738 (TLS: pin:..., SNI: voice.azsyc.com)
WebRTC ICE UDP: :50000
HTTP 监听: :8080
```

浏览器访问 `http://<服务器地址>:8080`，输入用户名和 Mumble 服务器密码即可使用。

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

**本项目完全无状态：**

- 没有数据库、没有文件存储、不需要 Docker Volume
- 每个浏览器会话是一个独立的 Mumble 登录，状态仅存于内存
- 删除容器不会丢失任何数据（聊天记录不落盘，刷新页面即重新同步）
- 无需备份；需要保留的只有 `.env` 配置文件本身

---

## 5. 配置与 Secret

- 所有配置通过 `.env` 注入（模板见 `.env.example`），`.env` 已被 `.gitignore` 排除
- 项目内**没有任何**需要提交的密钥：Mumble 服务器密码由最终用户在网页登录框输入，不经过配置文件
- `MUMBLE_TLS` 的指纹是公开信息（任何人连接服务器都能获取），不属于 Secret

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MUMBLE_SERVER` | `voice.azsyc.com` | 上游服务器；无端口自动 SRV 解析 |
| `MUMBLE_TLS` | `pin:<现网证书指纹>` | `verify` / `pin:<sha256>` / `insecure` |
| `PORT` | `8080` | 对外 HTTP 端口 |
| `RTC_UDP_PORT` | `50000` | WebRTC UDP 端口 |
| `RTC_PUBLIC_IP` | 空 | 代理在 NAT 后时填公网 IP |

---

## 6. HTTPS 与公网部署（建议）

浏览器只在安全上下文（HTTPS 或 localhost）下允许麦克风。公网部署示例（Caddy）：

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy 会自动处理 WebSocket 升级与证书。UDP 50000 不经过反代，直接对公网放行。

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
