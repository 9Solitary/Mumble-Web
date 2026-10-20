package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mumbleweb/server/internal/invite"
)

const testInviteSecret = "test-invite-secret"

func newInviteMux(api *inviteAPI) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/invites", api.create)
	mux.HandleFunc("GET /api/invites/{token}", api.validate)
	return mux
}

func TestInviteAPIBotRequiresSecret(t *testing.T) {
	api := &inviteAPI{store: invite.NewStore(time.Minute), secret: ""}
	rec := httptest.NewRecorder()
	api.create(rec, httptest.NewRequest(http.MethodPost, "/api/invites", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("未配置 secret 时应 403，实际 %d", rec.Code)
	}

	api.secret = testInviteSecret
	rec = httptest.NewRecorder()
	api.create(rec, httptest.NewRequest(http.MethodPost, "/api/invites", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("缺失 Bearer 时应 401，实际 %d", rec.Code)
	}
}

func TestInviteAPIBotCreateAndValidate(t *testing.T) {
	st := invite.NewStore(time.Minute)
	api := &inviteAPI{
		store:       st,
		secret:      testInviteSecret,
		frontendURL: "https://chat.example.com/app/",
	}

	body := strings.NewReader(`{"serverAddr":"mumble.example.com","password":"server-pw"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/invites", body)
	req.Header.Set("Authorization", "Bearer "+testInviteSecret)
	rec := httptest.NewRecorder()
	api.create(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建应 200，实际 %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "server-pw") {
		t.Fatal("响应不得包含服务器密码")
	}

	var created struct {
		Token     string `json:"token"`
		URL       string `json:"url"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("解析响应: %v", err)
	}
	if created.Token == "" || created.URL != "https://chat.example.com/app/invite/"+created.Token {
		t.Fatalf("token/url 错误: %+v", created)
	}
	if created.ExpiresAt <= time.Now().Unix() {
		t.Fatalf("expiresAt 应在未来: %d", created.ExpiresAt)
	}

	// GET 校验保持既有形状，且对网页邀请同样开放。
	mux := newInviteMux(api)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/invites/" + created.Token)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	var valid struct {
		Valid bool `json:"valid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&valid); err != nil || !valid.Valid {
		t.Fatalf("有效邀请应通过校验: valid=%v err=%v", valid.Valid, err)
	}

	invalid, err := http.Get(srv.URL + "/api/invites/not-a-real-token")
	if err != nil {
		t.Fatalf("GET invalid: %v", err)
	}
	defer invalid.Body.Close()
	var rejected struct {
		Valid bool   `json:"valid"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(invalid.Body).Decode(&rejected); err != nil {
		t.Fatalf("解析失败响应: %v", err)
	}
	if rejected.Valid || rejected.Code != "invite_invalid" {
		t.Fatalf("无效邀请应返回 invite_invalid: %+v", rejected)
	}
}

func TestInviteAPIBotURLFromRequestHost(t *testing.T) {
	api := &inviteAPI{store: invite.NewStore(time.Minute), secret: testInviteSecret}
	req := httptest.NewRequest(http.MethodPost, "http://proxy.example.com/api/invites", nil)
	req.Host = "chat.example.com"
	req.Header.Set("Authorization", "Bearer "+testInviteSecret)
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	api.create(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("创建应 200，实际 %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("解析响应: %v", err)
	}
	if !strings.HasPrefix(created.URL, "https://chat.example.com/invite/") {
		t.Fatalf("未按请求 Host/Proto 生成链接: %q", created.URL)
	}
}

func TestWebInviteBaseURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://proxy.example.com/ws", nil)
	req.Host = "proxy.example.com"

	if got := webInviteBaseURL("https://chat.example.com/mumble/", req); got != "https://chat.example.com/mumble" {
		t.Fatalf("FRONTEND_URL 优先且去尾斜杠: %q", got)
	}

	req.Header.Set("Origin", "https://chat.example.com")
	if got := webInviteBaseURL("", req); got != "https://chat.example.com" {
		t.Fatalf("应优先使用浏览器 Origin: %q", got)
	}

	req.Header.Del("Origin")
	req.Header.Set("X-Forwarded-Proto", "https")
	if got := webInviteBaseURL("", req); got != "https://proxy.example.com" {
		t.Fatalf("无 Origin 时回退 Host/Proto: %q", got)
	}

	req.Header.Set("Origin", "null")
	if got := webInviteBaseURL("", req); got != "https://proxy.example.com" {
		t.Fatalf("非法 Origin 应回退 Host: %q", got)
	}

	if got := joinInviteURL("", "tok"); got != "" {
		t.Fatalf("空 base 不应生成相对链接: %q", got)
	}
}
