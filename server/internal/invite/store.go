// Package invite 实现一次性邀请链接的内存存储。
// 邀请由机器人后端调用 POST /api/invites 创建，token 在 TTL 内有效；
// 首个凭 token 成功登录 Mumble 的会话认领它，会话结束后立即作废。
package invite

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"
)

// Invite 是一条一次性邀请记录。Password/ServerAddr 只存服务端，不下发给浏览器。
type Invite struct {
	Token      string
	ServerAddr string // 空表示使用代理默认上游
	Password   string
	ExpiresAt  time.Time
	Claimed    bool
}

type Store struct {
	mu  sync.Mutex
	m   map[string]*Invite
	ttl time.Duration
}

func NewStore(ttl time.Duration) *Store {
	return &Store{m: make(map[string]*Invite), ttl: ttl}
}

// Create 生成随机 token 并登记一条邀请。
func (s *Store) Create(serverAddr, password string) (*Invite, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	inv := &Invite{
		Token:      base64.RawURLEncoding.EncodeToString(buf),
		ServerAddr: serverAddr,
		Password:   password,
		ExpiresAt:  time.Now().Add(s.ttl),
	}
	s.mu.Lock()
	s.m[inv.Token] = inv
	s.mu.Unlock()
	return inv, nil
}

// Validate 检查 token 当前可用（存在、未过期、未被认领）。
func (s *Store) Validate(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.m[token]
	return ok && !inv.Claimed && time.Now().Before(inv.ExpiresAt)
}

// Claim 原子地校验并认领 token；成功返回邀请内容（含密码），失败返回 nil。
func (s *Store) Claim(token string) (*Invite, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.m[token]
	if !ok || inv.Claimed || time.Now().After(inv.ExpiresAt) {
		return nil, false
	}
	inv.Claimed = true
	return inv, true
}

// Release 解除认领（Mumble 登录失败时允许 TTL 内重试）。
func (s *Store) Release(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if inv, ok := s.m[token]; ok {
		inv.Claimed = false
	}
}

// Delete 彻底作废 token（会话结束时调用）。
func (s *Store) Delete(token string) {
	s.mu.Lock()
	delete(s.m, token)
	s.mu.Unlock()
}

// StartCleaner 周期清理过期邀请，直到 stop 关闭。
func (s *Store) StartCleaner(stop <-chan struct{}) {
	ticker := time.NewTicker(time.Minute)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				now := time.Now()
				s.mu.Lock()
				for token, inv := range s.m {
					if now.After(inv.ExpiresAt) {
						delete(s.m, token)
					}
				}
				s.mu.Unlock()
			case <-stop:
				return
			}
		}
	}()
}
