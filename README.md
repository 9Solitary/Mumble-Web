# Mumble Web — 类 Discord 的 Mumble 网页客户端

浏览器直连 Mumble 服务器不可能（浏览器没有裸 TCP/TLS 与 UDP），本项目采用
「React 前端 ⇄ Go 代理 ⇄ Murmur」三层架构：

```
浏览器                         Go 代理                      Murmur
React + shadcn/ui   WebSocket   控制桥(gumble)   TCP+TLS+Protobuf   voice.azsyc.com
WebRTC(Opus)     ◄──────────►   媒体桥(Pion)   ◄─────────────────►  (SRV → tencent.
                 WebRTC/RTP                  Mumble UDPTunnel      azsyc.com:64738)
```

- **控制通道**：WebSocket JSON 协议（登录、频道树、用户状态、文字消息、静音/闭麦）
- **语音通道**：浏览器 WebRTC（原生 Opus、回声消除、抖动缓冲）⇄ 代理不解码、不重编码，
  将 Opus 负载在 RTP 与 Mumble 语音帧之间**透传**，每个说话人一条 RTP track
- **上游语音模式**：当前走 Mumble `UDPTunnel`（TCP 隧道）；UDP + AES-OCB 为后续升级项

## 功能

- Discord 风格三栏布局：频道树（含频道内用户、说话指示灯）/ 聊天 / 成员列表
- 文字聊天（按频道）
- 实时语音：按键说话（空格）/ 自由发言、静音、闭麦、单用户音量调节
- SRV 解析：自动解析 `_mumble._tcp.voice.azsyc.com`
- TLS 三级策略：`verify`（正常校验）/ `pin:<sha256指纹>`（证书固定）/ `insecure`（调试）

## 运行

### Docker（推荐）

```bash
docker build -t mumble-web .
docker run -p 8080:8080 -p 50000:50000/udp \
  -e MUMBLE_SERVER=voice.azsyc.com \
  -e MUMBLE_TLS='pin:BC:3C:29:BC:A9:C7:C4:73:95:90:E8:B0:4A:65:14:E1:E8:8C:30:F3:BA:94:AB:8B:26:B4:8A:6D:B7:AE:4D:CF' \
  mumble-web
```

打开 `http://localhost:8080`，输入用户名与**服务器密码**即可。

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
| `MUMBLE_SERVER` | `voice.azsyc.com` | 上游服务器；无端口时自动 SRV 解析 |
| `MUMBLE_TLS` | `pin:<当前证书指纹>` | `verify` / `pin:<指纹>` / `insecure` |
| `LISTEN` / `PORT` | `:8080` | HTTP 监听 |
| `RTC_UDP_PORT` | `50000` | WebRTC ICE UDP 端口（需对浏览器可达） |
| `RTC_PUBLIC_IP` | 空 | 代理在 NAT 后时填公网 IP |
| `STATIC_DIR` | `dist` | 前端静态资源目录 |

## 部署注意

1. **HTTPS**：浏览器要求安全上下文才给麦克风权限，公网部署请配 TLS（反代/Caddy）。
2. **UDP 50000**：浏览器与代理之间的 WebRTC 依赖此端口，防火墙/安全组需放行。
3. **服务器证书**：`voice.azsyc.com` 的 Let's Encrypt 证书已过期（2024-04）。本项目默认使用
   `pin:` 指纹固定模式（当前指纹已内置），过渡期安全可用。**治本**需在服务器上修复自动续期：

   ```bash
   # SSH 登录服务器（tencent.azsyc.com / 124.223.83.5）后：
   sudo certbot renew --force-renewal          # 立即续期
   sudo systemctl list-timers | grep certbot   # 检查自动续期定时器为何失效
   sudo systemctl restart mumble-server        # 让 murmur 加载新证书
   ```

   续期完成后把 `MUMBLE_TLS` 改为 `verify` 即可（指纹会随新证书变化，pin 值需同步更新）。
4. **服务器密码**：Murmur 已启用服务器密码，网页登录时需填写。

## 代码结构

```
src/                  React 前端（shadcn/ui + zustand）
  lib/protocol.ts     WS 协议类型
  lib/mumbleClient.ts WS + WebRTC 客户端
  store/appStore.ts   全局状态
  components/         界面组件
server/               Go 代理
  cmd/proxy/          服务入口
  cmd/smoketest/      上游联调工具
  internal/bridge/    会话/信令/语音桥
  internal/gumble/    Mumble 协议栈（vendor + 透传补丁，MPL-2.0）
  internal/mumbleconn/ SRV 解析与 TLS 策略
```

## 后续路线

- [ ] Mumble 原生 UDP 语音（AES-OCB），替换 TCP 隧道
- [ ] WebTransport 语音通道（替代 WebRTC，浏览器已 Baseline）
- [ ] 用户头像（Mumble texture 拉取）
- [ ] 聊天记录持久化、图片消息
