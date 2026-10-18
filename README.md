# Mumble Web — 类 Discord 的 Mumble 网页客户端

浏览器直连 Mumble 服务器不可能（浏览器没有裸 TCP/TLS 与 UDP），本项目采用
「React 前端 ⇄ Go 代理 ⇄ Murmur」三层架构：

```
浏览器                         Go 代理                      Murmur
React + shadcn/ui   WebSocket   控制桥(gumble)   TCP+TLS+Protobuf   任意 Mumble 服务器
WebRTC(Opus)     ◄──────────►   媒体桥(Pion)   ◄─────────────────►  （支持 SRV 解析，
                 WebRTC/RTP                  Mumble UDPTunnel       默认端口 64738）
```

- **控制通道**：WebSocket JSON 协议（登录、频道树、用户状态、文字消息、静音/闭麦）
- **语音通道**：浏览器 WebRTC（原生 Opus、回声消除、抖动缓冲）⇄ 代理不解码、不重编码，
  将 Opus 负载在 RTP 与 Mumble 语音帧之间**透传**，每个说话人一条 RTP track
- **上游语音模式**：当前走 Mumble `UDPTunnel`（TCP 隧道）；UDP + AES-OCB 为后续升级项

## 功能

- Discord 风格三栏布局：频道树（单击选中高亮、双击加入语音；含频道内用户、说话指示灯）/ 聊天 / 成员列表
- 文字聊天（按频道，支持粘贴 / 选择图片发送，自动压缩到服务器长度限制内）
- 实时语音：按键说话（空格）/ 自由发言（VAD 阈值可调）、静音、闭麦；自己的说话指示由本地门控状态驱动
- 设置面板（参考 Mumble 客户端）：音频输入 / 输出设备选择（热切换，无需重连）、
  自由发言触发阈值（附实时电平条校准），设置经 localStorage 本地持久化
- 单用户音量调节与本地屏蔽发言：成员列表 / 频道内用户右键菜单（成员列表左键也可调音量）
- SRV 解析：服务器名不带端口时自动解析 `_mumble._tcp.<name>`
- TLS 三级策略：`verify`（正常校验）/ `pin:<sha256指纹>`（证书固定）/ `insecure`（调试）
- 一次性邀请链接：机器人后端调用 API 生成限时链接，受邀者只需输入用户名即可加入（见下文）

## 运行

### Docker Compose（推荐）

```bash
cp .env.example .env     # 编辑 .env，填入你的 Mumble 服务器地址与 TLS 策略
docker compose up -d
```

打开 `http://localhost:8080`，输入用户名与**服务器密码**即可。

常用运维命令：

```bash
docker compose logs -f            # 查看日志
docker compose ps                 # 容器状态
docker compose down               # 停止
docker compose up -d --build      # 更新代码后重建
```

纯 Docker（不用 Compose，web 与 proxy 两个镜像）：

```bash
docker build -t mumble-web-proxy .
docker build -t mumble-web -f Dockerfile.web .
docker run -p 8081:8081 -p 50000:50000/udp mumble-web-proxy
docker run -p 8080:80 -e PROXY_ORIGIN=http://<proxy地址>:8081 mumble-web
```

> 完整的部署与维护手册（含 web/proxy 分离部署与迁移说明）见 [DEPLOYMENT.md](DEPLOYMENT.md)。

### 本地开发

```bash
# 后端（端口 8080，自带静态资源服务于 ../dist）
cd server && go run ./cmd/proxy -static ../dist

# 前端（Vite 开发服务器，另开终端）
npm run dev
```

## 配置项（环境变量 / 命令行参数一致）

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `MUMBLE_SERVER` | `localhost:64738` | 上游服务器；无端口时自动 SRV 解析 |
| `MUMBLE_TLS` | `verify` | `verify` / `pin:<指纹>` / `insecure` |
| `LISTEN` / `PORT` | `:8080` | HTTP 监听 |
| `RTC_UDP_PORT` | `50000` | WebRTC ICE UDP 端口（需对浏览器可达） |
| `RTC_PUBLIC_IP` | 空 | 代理在 NAT 后时填公网 IP |
| `STATIC_DIR` | `dist` | 前端静态资源目录 |
| `ALLOW_SERVER_OVERRIDE` | `true` | 允许网页端连接页自选上游服务器（填 `false` 则锁定为 `MUMBLE_SERVER`） |
| `INVITE_SECRET` | 空（关闭） | 邀请创建 API 的 Bearer 密钥；配置后启用一次性邀请链接功能 |
| `INVITE_TTL` | `30m` | 邀请链接有效期（Go duration 格式） |
| `FRONTEND_URL` | 空 | 生成邀请链接用的前端地址；空 = 按请求来源拼接（分离部署且 bot 直连代理时设置） |

以上为代理进程配置。web 容器另有：`PROXY_ORIGIN`（浏览器直连代理的地址，空 = 同源回源）、
`PROXY_UPSTREAM`（容器内回源目标，默认 `172.31.250.1:8081`，即 compose 固定内网的宿主机网关）。

连接页会显示并预填当前配置的服务器地址/端口，用户可直接修改后连接（TLS 策略沿用代理配置）。

## 邀请链接 / Bot 对接

配置 `INVITE_SECRET` 后，机器人后端（如 QQ 官方 bot 的服务端）可调用 API 生成一次性邀请链接：

```bash
curl -X POST https://<host>:8080/api/invites \
  -H "Authorization: Bearer $INVITE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"serverAddr":"可选，默认代理上游","password":"可选，服务器密码"}'
# => {"token":"...","url":"https://<host>:8080/invite/<token>","expiresAt":1729000000}
```

bot 把返回的 `url` 发给用户即可。语义：

- 链接自创建起 `INVITE_TTL`（默认 30 分钟）内有效；过期自动作废。
- 受邀用户打开链接后，页面**不显示服务器/端口与密码框**（密码只存服务端，不在 URL 中），
  只需输入用户名即可进入大厅，本次会话不限时长。
- 一次性：首个成功登录的会话认领该链接；用户退出登录或断线后链接立即作废，
  其他人访问会提示已失效。
- 邀请为纯内存态，代理重启即清空。
- 鉴权说明：`INVITE_SECRET` 只部署在代理与 bot 后端，切勿下发给普通用户；
  未配置时 `POST /api/invites` 返回 403。

## 部署注意

1. **HTTPS**：浏览器要求安全上下文才给麦克风权限，公网部署请配 TLS（反代/Caddy）。
2. **UDP 50000**：浏览器与代理之间的 WebRTC 依赖此端口，防火墙/安全组需放行。
3. **上游服务器证书**：若证书自签或已过期，可用 `MUMBLE_TLS=pin:<sha256指纹>` 固定指纹过渡
   （指纹获取：`openssl s_client -connect <host>:64738 </dev/null 2>/dev/null | openssl x509 -fingerprint -sha256 -noout`）。
   证书恢复正常后改回 `verify`（指纹随证书变化，pin 值需同步更新）。
4. **服务器密码**：若 Murmur 启用了服务器密码，网页登录时需填写。

## 代码结构

```
src/                  React 前端（shadcn/ui + zustand）
  lib/protocol.ts     WS 协议类型
  lib/mumbleClient.ts WS + WebRTC 客户端
  store/appStore.ts   全局状态
  components/         界面组件（频道树 / 聊天 / 成员列表 / 设置面板 / 用户右键菜单）
server/               Go 代理
  cmd/proxy/          服务入口
  cmd/smoketest/      上游联调工具
  internal/bridge/    会话/信令/语音桥
  internal/invite/    一次性邀请链接存储（内存态）
  internal/gumble/    Mumble 协议栈（vendor + 透传补丁，MPL-2.0）
  internal/mumbleconn/ SRV 解析与 TLS 策略
```

## 后续路线

- [ ] Mumble 原生 UDP 语音（AES-OCB），替换 TCP 隧道
- [ ] WebTransport 语音通道（替代 WebRTC，浏览器已 Baseline）
- [ ] 用户头像（Mumble texture 拉取）
- [ ] 聊天记录持久化
