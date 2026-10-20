// Package invite 实现一次性邀请链接的内存存储。
// 邀请可由已登录的网页会话通过 WebSocket 创建，也可由机器人后端调用
// POST /api/invites 创建；token 在 TTL 内有效，首个凭 token 成功登录 Mumble
// 的会话认领它，会话结束后立即作废。
//
// 邀请登录成功后额外签发 resume token（断线恢复凭据）：
// 邀请用户挂机断线后 5 分钟内可凭它重连恢复原凭据，无需新邀请链接。
// resume token 与原邀请 token 生命周期相互独立。
package invite

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"sync"
	"time"
)

// ResumeTTL 是断线恢复凭据的有效期（从签发起算，不滑动）。
const ResumeTTL = 5 * time.Minute

// Invite 是一条一次性邀请记录。Password/ServerAddr 只存服务端，不下发给浏览器。
type Invite struct {
	Token      string
	ServerAddr string // 空表示使用代理默认上游
	Password   string
	ExpiresAt  time.Time
	Claimed    bool
}

// ResumeToken 是邀请用户的断线恢复凭据，绑定签发时的登录凭据。
type ResumeToken struct {
	Token      string
	Username   string
	ServerAddr string
	Password   string
	ExpiresAt  time.Time
}

type Store struct {
	mu        sync.Mutex
	m         map[string]*Invite
	resume    map[string]*ResumeToken
	ttl       time.Duration
	resumeTTL time.Duration
}

func NewStore(ttl time.Duration) *Store {
	return &Store{
		m:         make(map[string]*Invite),
		resume:    make(map[string]*ResumeToken),
		ttl:       ttl,
		resumeTTL: ResumeTTL,
	}
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

// Len 返回当前仍保留在内存中的邀请记录数（含尚未被清理的过期项）。
// 仅用于观测与测试；不改变邀请生命周期。
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
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

// IssueResume 为邀请登录成功的会话签发断线恢复凭据（16 字节随机数的 hex，32 字符）。
func (s *Store) IssueResume(username, serverAddr, password string) (*ResumeToken, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	rt := &ResumeToken{
		Token:      hex.EncodeToString(buf),
		Username:   username,
		ServerAddr: serverAddr,
		Password:   password,
		ExpiresAt:  time.Now().Add(s.resumeTTL),
	}
	s.mu.Lock()
	s.resume[rt.Token] = rt
	s.mu.Unlock()
	return rt, nil
}

// RedeemResume 用恢复凭据换回原登录凭据（存在、未过期、username 与签发时绑定的一致）。
//
// 有效期窗口内可重复使用而非一次性：断线重连是指数退避重试，
// 一次恢复可能经历多次失败尝试（如上游服务器尚未恢复），
// 做成一次性会在首次重试失败后把用户彻底锁在门外。
func (s *Store) RedeemResume(token, username string) (*ResumeToken, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rt, ok := s.resume[token]
	if !ok || time.Now().After(rt.ExpiresAt) || rt.Username != username {
		return nil, false
	}
	return rt, true
}

// RevokeResume 吊销恢复凭据（用户主动退出时调用）。
func (s *Store) RevokeResume(token string) {
	s.mu.Lock()
	delete(s.resume, token)
	s.mu.Unlock()
}

// StartCleaner 周期清理过期邀请与过期恢复凭据，直到 stop 关闭。
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
				for token, rt := range s.resume {
					if now.After(rt.ExpiresAt) {
						delete(s.resume, token)
					}
				}
				s.mu.Unlock()
			case <-stop:
				return
			}
		}
	}()
}
