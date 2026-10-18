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
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
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

	var (
		listen        = flag.String("listen", envOr("LISTEN", ":"+envOr("PORT", "8080")), "HTTP 监听地址")
		server        = flag.String("mumble-server", envOr("MUMBLE_SERVER", "localhost:64738"), "Mumble 服务器（host 或 host:port，无端口时走 SRV 解析）")
		tlsMode       = flag.String("mumble-tls", envOr("MUMBLE_TLS", "verify"), "上游 TLS 策略: verify | insecure | pin:<sha256指纹>")
		staticDir     = flag.String("static", envOr("STATIC_DIR", "dist"), "前端静态资源目录")
		rtcUDPPort    = flag.Int("rtc-udp-port", envOrInt("RTC_UDP_PORT", 50000), "WebRTC ICE UDP 端口")
		publicIP      = flag.String("rtc-public-ip", envOr("RTC_PUBLIC_IP", ""), "代理的公网 IP（NAT 后部署时填写）")
		allowOverride = flag.Bool("allow-server-override", envOr("ALLOW_SERVER_OVERRIDE", "true") != "false", "允许网页端连接时自选 Mumble 服务器")
		inviteSecret  = flag.String("invite-secret", envOr("INVITE_SECRET", ""), "邀请链接 API 的 Bearer 密钥（留空则关闭邀请功能）")
		inviteTTL     = flag.Duration("invite-ttl", envOrDuration("INVITE_TTL", 30*time.Minute), "邀请链接有效期")
		diagDir       = flag.String("diag-dir", envOr("DIAG_DIR", "."), "诊断上报落盘目录（diag.jsonl）")
	)
	flag.Parse()

	slog.Info("proxy_start", "event", "proxy_start", "version", version)

	// 邀请存储：仅内存态，重启即清空（符合一次性短时效语义）
	var inviteStore *invite.Store
	if *inviteSecret != "" {
		inviteStore = invite.NewStore(*inviteTTL)
		inviteStore.StartCleaner(make(chan struct{}))
		slog.Info("invite_enabled", "event", "invite_enabled", "ttl", inviteTTL.String())
	} else {
		slog.Info("invite_disabled", "event", "invite_disabled", "reason", "INVITE_SECRET 未配置")
	}

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

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("ws_upgrade_failed", "event", "ws_upgrade_failed", "error", err.Error())
			return
		}
		sess := bridge.NewSession(ws, target, udpMux, *publicIP, *allowOverride, inviteStore, newSID(), version)
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
	// 邀请创建：供 QQ 机器人等 bot 后端调用，需 Bearer 鉴权。
	mux.HandleFunc("POST /api/invites", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if inviteStore == nil {
			http.Error(w, `{"error":"邀请功能未启用"}`, http.StatusForbidden)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+*inviteSecret {
			http.Error(w, `{"error":"未授权"}`, http.StatusUnauthorized)
			return
		}
		var req struct {
			ServerAddr string `json:"serverAddr"`
			Password   string `json:"password"`
		}
		// 空 body 视为默认配置邀请
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req)
		}
		inv, err := inviteStore.Create(req.ServerAddr, req.Password)
		if err != nil {
			http.Error(w, `{"error":"生成邀请失败"}`, http.StatusInternalServerError)
			return
		}
		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		url := fmt.Sprintf("%s://%s/invite/%s", scheme, r.Host, inv.Token)
		slog.Info("invite_created", "event", "invite_created",
			"token", inv.Token[:8], "server", req.ServerAddr, "expires_at", inv.ExpiresAt.Format(time.RFC3339))
		fmt.Fprintf(w, `{"token":%q,"url":%q,"expiresAt":%d}`,
			inv.Token, url, inv.ExpiresAt.Unix())
	})
	// 邀请校验：前端打开邀请链接时调用；永不返回密码。
	mux.HandleFunc("GET /api/invites/{token}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		token := r.PathValue("token")
		if inviteStore == nil || !inviteStore.Validate(token) {
			fmt.Fprint(w, `{"valid":false,"reason":"邀请链接无效、已过期或已被使用"}`)
			return
		}
		fmt.Fprint(w, `{"valid":true}`)
	})
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
	if err := http.ListenAndServe(*listen, mux); err != nil {
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
