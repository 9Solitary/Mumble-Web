// mumble-web-proxy：Mumble 网页端代理服务器。
//
// 职责：
//  1. 提供前端静态资源（生产模式服务 dist/）
//  2. /ws 提供 WebSocket，承载控制信令与 WebRTC 信令
//  3. 每个浏览器会话对应一个独立的 Mumble 登录（gumble）
//  4. WebRTC（Pion）<-> Mumble 语音（UDPTunnel）的 Opus 透传
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"

	"mumbleweb/server/internal/bridge"
	"mumbleweb/server/internal/invite"
	"mumbleweb/server/internal/mumbleconn"
)

// 构建版本，由 -ldflags "-X main.version=<git sha>" 注入；本地开发默认 "dev"。
var version = "dev"

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// 同源部署（静态资源也由本进程提供），无需严格 Origin 校验
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	// 结构化日志：JSON 输出到 stdout（容器由 json-file 驱动收集轮转），
	// 时间字段统一命名为 ts，与会话日志的 sid/event/uptime_s 对齐。
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if len(groups) == 0 && a.Key == slog.TimeKey {
				a.Key = "ts"
			}
			return a
		},
	})))

	// 直接运行 proxy.exe 时也读取 .env（shell 环境变量优先）。
	// 兼容从仓库根目录或 server/ 目录启动。
	envFile := ".env"
	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		if _, parentErr := os.Stat("../.env"); parentErr == nil {
			envFile = "../.env"
		}
	}
	if keys, err := loadDotEnv(envFile); err == nil {
		slog.Info("env_loaded", "event", "env_loaded", "file", envFile, "keys", keys)
	} else if !os.IsNotExist(err) {
		slog.Warn("env_load_failed", "event", "env_load_failed", "file", envFile, "error", err.Error())
	}

	var (
		listen        = flag.String("listen", envOr("LISTEN", ":"+envOr("PORT", "8080")), "HTTP 监听地址")
		server        = flag.String("mumble-server", envOr("MUMBLE_SERVER", "localhost:64738"), "Mumble 服务器（host 或 host:port，无端口时走 SRV 解析）")
		tlsMode       = flag.String("mumble-tls", envOr("MUMBLE_TLS", "verify"), "上游 TLS 策略: verify | insecure | pin:<sha256指纹>")
		staticDir     = flag.String("static", envOr("STATIC_DIR", "dist"), "前端静态资源目录")
		rtcUDPPort    = flag.Int("rtc-udp-port", envOrInt("RTC_UDP_PORT", 50000), "WebRTC ICE UDP 端口")
		publicIP      = flag.String("rtc-public-ip", envOr("RTC_PUBLIC_IP", ""), "代理的公网 IP（NAT 后部署时填写）")
		allowOverride = flag.Bool("allow-server-override", envOr("ALLOW_SERVER_OVERRIDE", "true") != "false", "允许网页端连接时自选 Mumble 服务器")
		inviteSecret  = flag.String("invite-secret", envOr("INVITE_SECRET", ""), "bot 邀请 API 的 Bearer 密钥（留空则关闭 bot 创建）")
		inviteTTL     = flag.Duration("invite-ttl", envOrDuration("INVITE_TTL", 30*time.Minute), "邀请链接有效期")
		webInvite     = flag.Bool("web-invite-enabled", envOr("WEB_INVITE_ENABLED", "true") != "false", "允许已登录用户在网页里创建邀请")
		diagDir       = flag.String("diag-dir", envOr("DIAG_DIR", "."), "诊断上报落盘目录（diag.jsonl）")
		frontendURL   = flag.String("frontend-url", envOr("FRONTEND_URL", ""), "前端页面的对外地址（如 https://chat.example.com），用于生成邀请链接；留空按请求来源拼接")
	)
	flag.Parse()

	slog.Info("proxy_start", "event", "proxy_start", "version", version)

	// 邀请存储始终创建：网页邀请、受邀登录、resume 与 bot API 共用同一份内存态。
	// bot 的 POST 仍只由 INVITE_SECRET 控制；网页创建由 WEB_INVITE_ENABLED 控制。
	inviteStore := invite.NewStore(*inviteTTL)
	inviteStore.StartCleaner(make(chan struct{}))
	slog.Info("invite_enabled", "event", "invite_enabled", "ttl", inviteTTL.String(),
		"web", *webInvite, "bot", *inviteSecret != "")

	target, err := mumbleconn.Resolve(*server, *tlsMode)
	if err != nil {
		slog.Error("resolve_failed", "event", "resolve_failed", "error", err.Error())
		os.Exit(1)
	}
	slog.Info("upstream_resolved", "event", "upstream_resolved",
		"original", target.Original, "address", target.Address, "tls", target.TLSMode, "sni", target.SNI)

	// WebRTC 全局 UDP 复用端口（ICE-Lite，所有会话共享）
	var udpMux ice.UDPMux
	udpConn, err := net.ListenUDP("udp", &net.UDPAddr{Port: *rtcUDPPort})
	if err != nil {
		slog.Warn("rtc_udp_unavailable", "event", "rtc_udp_unavailable", "port", *rtcUDPPort, "error", err.Error())
	} else {
		udpMux = webrtc.NewICEUDPMux(nil, udpConn)
		slog.Info("rtc_udp_ready", "event", "rtc_udp_ready", "port", *rtcUDPPort)
	}

	diag := newDiagSink(*diagDir)

	// 同名会话注册表：代理内部拒绝重名新登录，同标签页重连才允许接管，避免互踢。
	registry := bridge.NewSessionRegistry()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("ws_upgrade_failed", "event", "ws_upgrade_failed", "error", err.Error())
			return
		}
		baseURL := webInviteBaseURL(*frontendURL, r)
		sess := bridge.NewSession(ws, target, udpMux, *publicIP, *allowOverride, inviteStore, registry, newSID(), version,
			*webInvite,
			func(token string) string { return joinInviteURL(baseURL, token) },
		)
		sess.Run()
	})
	mux.HandleFunc("/api/server", func(w http.ResponseWriter, r *http.Request) {
		// 供连接页预填服务器地址；不含 tlsMode，避免把 pin 指纹暴露到界面之外的接口
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"address":%q,"resolved":%q,"allowOverride":%t}`,
			target.Original, target.Address, *allowOverride)
	})
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"version":%q}`, version)
	})
	// 诊断上报：前端错误/事件批量落盘 diag.jsonl（详见 diag.go 隐私说明）
	mux.HandleFunc("POST /api/diag", diag.handler)
	// 邀请 API：POST 仅 bot 使用（Bearer）；GET 校验对网页邀请同样开放。
	invitesAPI := &inviteAPI{store: inviteStore, secret: *inviteSecret, frontendURL: *frontendURL}
	mux.HandleFunc("POST /api/invites", invitesAPI.create)
	mux.HandleFunc("GET /api/invites/{token}", invitesAPI.validate)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// 静态资源（SPA：未命中路径回退 index.html）
	if abs, err := filepath.Abs(*staticDir); err == nil {
		if _, err := os.Stat(abs); err == nil {
			mux.Handle("/", spaHandler(abs))
			slog.Info("static_ready", "event", "static_ready", "dir", abs)
		} else {
			slog.Warn("static_missing", "event", "static_missing", "dir", abs)
		}
	}

	slog.Info("http_listen", "event", "http_listen", "listen", *listen)
	if err := http.ListenAndServe(*listen, corsAPI(mux)); err != nil {
		slog.Error("http_serve_failed", "event", "http_serve_failed", "error", err.Error())
		os.Exit(1)
	}
}

// newSID 生成随机会话标识（8 字节随机数的 hex，16 字符）。
func newSID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand 不可用时退化为时间戳，仅影响日志关联，不影响功能
		return fmt.Sprintf("%016x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// corsAPI 允许浏览器跨源调用 /api/*（前后端分离部署时页面与代理不同源）。
// 浏览器侧请求不携带凭据、邀请创建有 Bearer 鉴权，Allow-Origin 用 * 即可；
// WebSocket 不受同源策略约束，无需处理。
func corsAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			r.URL.Path = "/"
		}
		fs.ServeHTTP(w, r)
	})
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscan(v, &n); err == nil {
			return n
		}
	}
	return def
}

func envOrDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
