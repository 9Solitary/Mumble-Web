// mumble-web-proxy：Mumble 网页端代理服务器。
//
// 职责：
//  1. 提供前端静态资源（生产模式服务 dist/）
//  2. /ws 提供 WebSocket，承载控制信令与 WebRTC 信令
//  3. 每个浏览器会话对应一个独立的 Mumble 登录（gumble）
//  4. WebRTC（Pion）<-> Mumble 语音（UDPTunnel）的 Opus 透传
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"

	"mumbleweb/server/internal/bridge"
	"mumbleweb/server/internal/mumbleconn"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// 同源部署（静态资源也由本进程提供），无需严格 Origin 校验
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	var (
		listen     = flag.String("listen", envOr("LISTEN", ":"+envOr("PORT", "8080")), "HTTP 监听地址")
		server     = flag.String("mumble-server", envOr("MUMBLE_SERVER", "voice.azsyc.com"), "Mumble 服务器（host 或 host:port，无端口时走 SRV 解析）")
		tlsMode    = flag.String("mumble-tls", envOr("MUMBLE_TLS", "insecure"), "上游 TLS 策略: verify | insecure | pin:<sha256指纹>")
		staticDir  = flag.String("static", envOr("STATIC_DIR", "dist"), "前端静态资源目录")
		rtcUDPPort = flag.Int("rtc-udp-port", envOrInt("RTC_UDP_PORT", 50000), "WebRTC ICE UDP 端口")
		publicIP   = flag.String("rtc-public-ip", envOr("RTC_PUBLIC_IP", ""), "代理的公网 IP（NAT 后部署时填写）")
	)
	flag.Parse()

	target, err := mumbleconn.Resolve(*server, *tlsMode)
	if err != nil {
		log.Fatalf("解析 Mumble 服务器失败: %v", err)
	}
	log.Printf("上游 Mumble: %s -> %s (TLS: %s, SNI: %s)",
		target.Original, target.Address, target.TLSMode, target.SNI)

	// WebRTC 全局 UDP 复用端口（ICE-Lite，所有会话共享）
	var udpMux ice.UDPMux
	udpConn, err := net.ListenUDP("udp", &net.UDPAddr{Port: *rtcUDPPort})
	if err != nil {
		log.Printf("警告: WebRTC UDP 端口 %d 不可用: %v（语音将不可用）", *rtcUDPPort, err)
	} else {
		udpMux = webrtc.NewICEUDPMux(nil, udpConn)
		log.Printf("WebRTC ICE UDP: :%d", *rtcUDPPort)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("ws upgrade: %v", err)
			return
		}
		log.Printf("新会话: %s", r.RemoteAddr)
		sess := bridge.NewSession(ws, target, udpMux, *publicIP)
		sess.Run()
		log.Printf("会话结束: %s", r.RemoteAddr)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// 静态资源（SPA：未命中路径回退 index.html）
	if abs, err := filepath.Abs(*staticDir); err == nil {
		if _, err := os.Stat(abs); err == nil {
			mux.Handle("/", spaHandler(abs))
			log.Printf("静态资源: %s", abs)
		} else {
			log.Printf("静态资源目录 %s 不存在（仅 API 模式）", abs)
		}
	}

	log.Printf("HTTP 监听: %s", *listen)
	log.Fatal(http.ListenAndServe(*listen, mux))
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
