package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mumbleweb/server/internal/invite"
)

// inviteAPI 承载 bot 的 HTTP 邀请接口。
// 网页邀请走 WebSocket，不经过这里；GET 校验对两种来源都开放。
type inviteAPI struct {
	store       *invite.Store
	secret      string
	frontendURL string
}

func (a *inviteAPI) create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if a.secret == "" || a.store == nil {
		http.Error(w, `{"error":"邀请功能未启用"}`, http.StatusForbidden)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+a.secret {
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

	inv, err := a.store.Create(req.ServerAddr, req.Password)
	if err != nil {
		http.Error(w, `{"error":"生成邀请失败"}`, http.StatusInternalServerError)
		return
	}

	link := joinInviteURL(a.baseURL(r), inv.Token)
	// 只保留 token 前缀；URL/密码/服务器地址不写日志。
	slog.Info("invite_created", "event", "invite_created",
		"token", inviteTokenPrefix(inv.Token), "expires_at", inv.ExpiresAt.Format(time.RFC3339))
	fmt.Fprintf(w, `{"token":%q,"url":%q,"expiresAt":%d}`,
		inv.Token, link, inv.ExpiresAt.Unix())
}

func (a *inviteAPI) validate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	token := r.PathValue("token")
	if a.store == nil || !a.store.Validate(token) {
		// code 供前端映射本地化文案；reason 只作为“详情”排障。
		fmt.Fprint(w, `{"valid":false,"code":"invite_invalid","reason":"邀请链接无效、已过期或已被使用"}`)
		return
	}
	fmt.Fprint(w, `{"valid":true}`)
}

// baseURL 是 bot API 的链接前缀，保持既有行为：FRONTEND_URL 优先，否则按请求 Host。
func (a *inviteAPI) baseURL(r *http.Request) string {
	if a.frontendURL != "" {
		return strings.TrimRight(a.frontendURL, "/")
	}
	return requestBaseURL(r)
}

// webInviteBaseURL 是 WebSocket 网页邀请的链接前缀。
// 前后端分离部署时请求 Host 可能是 proxy，浏览器握手的 Origin 才是页面地址；
// 因此优先 FRONTEND_URL，其次 Origin，最后才回退到请求 Host。
func webInviteBaseURL(frontendURL string, r *http.Request) string {
	if frontendURL != "" {
		return strings.TrimRight(frontendURL, "/")
	}
	if origin := normalizeOrigin(r.Header.Get("Origin")); origin != "" {
		return origin
	}
	return requestBaseURL(r)
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, r.Host)
}

func normalizeOrigin(value string) string {
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func joinInviteURL(base, token string) string {
	if base == "" {
		return ""
	}
	return strings.TrimRight(base, "/") + "/invite/" + token
}

func inviteTokenPrefix(token string) string {
	if len(token) > 8 {
		return token[:8]
	}
	return token
}
