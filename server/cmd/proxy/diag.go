// 诊断上报端点（POST /api/diag）：
// 前端诊断模块批量上报事件，服务端逐行追加到 DIAG_DIR/diag.jsonl。
//
// 隐私红线：请求体只落盘到 diag.jsonl，绝不写入普通服务日志；
// 上报内容本身由前端脱敏（不含聊天内容/密码/用户名/token）。
package main

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// diagReport 是前端诊断模块上报的载荷。
type diagReport struct {
	SID     string      `json:"sid"`
	Version string      `json:"version"`
	Events  []diagEvent `json:"events"`
}

type diagEvent struct {
	TS   int64          `json:"ts"`
	Kind string         `json:"kind"`
	Data map[string]any `json:"data"`
}

// diagSink 将诊断事件写入 diag.jsonl，并按客户端 IP 限流。
type diagSink struct {
	mu      sync.Mutex // 串行化文件写入
	path    string
	limiter *ipRateLimiter
}

func newDiagSink(dir string) *diagSink {
	return &diagSink{
		path:    filepath.Join(dir, "diag.jsonl"),
		limiter: &ipRateLimiter{hits: make(map[string][]time.Time), limit: 30, window: time.Minute},
	}
}

func (d *diagSink) handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !d.limiter.allow(clientIP(r)) {
		http.Error(w, `{"error":"rate limited"}`, http.StatusTooManyRequests)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}
	var rep diagReport
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&rep); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if err := d.append(rep); err != nil {
		slog.Error("diag_write", "event", "diag_write", "error", err.Error())
		http.Error(w, `{"error":"write failed"}`, http.StatusInternalServerError)
		return
	}
	w.Write([]byte(`{"ok":true}`))
}

// append 逐行写入，每行一个事件；sid/version/recv_ts 由服务端补充。
func (d *diagSink) append(rep diagReport) error {
	if len(rep.Events) == 0 {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(d.path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(d.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	recv := time.Now().Unix()
	enc := json.NewEncoder(f)
	for _, ev := range rep.Events {
		if err := enc.Encode(map[string]any{
			"ts":      ev.TS,
			"kind":    ev.Kind,
			"data":    ev.Data,
			"sid":     rep.SID,
			"version": rep.Version,
			"recv_ts": recv,
		}); err != nil {
			return err
		}
	}
	return nil
}

// ipRateLimiter 按 IP 的滑动窗口限流（内存态，进程重启即清零）。
type ipRateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	limit  int
	window time.Duration
}

func (l *ipRateLimiter) allow(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	h := l.hits[ip]
	kept := h[:0]
	for _, t := range h {
		if now.Sub(t) < l.window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.limit {
		l.hits[ip] = kept
		return false
	}
	l.hits[ip] = append(kept, now)
	return true
}

// sameOrigin 校验 Origin/Referer 的 Host 与请求 Host 一致；
// sendBeacon 等无 Origin 的请求放行，由限流兜底。
func sameOrigin(r *http.Request) bool {
	ref := r.Header.Get("Origin")
	if ref == "" {
		ref = r.Header.Get("Referer")
	}
	if ref == "" {
		return true
	}
	u, err := url.Parse(ref)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func clientIP(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
