package bridge

import "sync"

// SessionRegistry 保证同一个 (上游服务器, 昵称) 在代理内部只有一个活跃会话。
//
// 语义：
//   - Reserve：拨号前占位。没有 owner 时正常占位；已有 owner 且 clientID 不同，
//     直接拒绝（旧会话保持在线，新登录收到 username_in_use）；clientID 相同表示
//     同一标签页刷新/断线重连，允许占位并返回旧 owner，由调用方在拨号成功后结束旧会话。
//   - Commit：新会话拨号成功后调用，返回旧 owner（仅同 clientID 重连时非 nil）。
//   - Release：拨号失败时释放占位，旧会话恢复正常。
//   - Unregister：会话清理时移除自己（仅当自己仍是 owner/pending）。
//
// Murmur 自身会在同名新登录时踢掉旧会话；registry 在拨号前先拒绝不同 clientID 的
// 同名登录，避免“后进者顶掉旧用户”，同时保留同一标签页的断线恢复能力。
type SessionRegistry struct {
	mu      sync.Mutex
	entries map[string]*registryEntry
}

type registryEntry struct {
	owner   *Session
	pending *Session
}

func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{entries: make(map[string]*registryEntry)}
}

// sameClient 判断两个会话是否来自同一个浏览器标签页。
// 空 clientID（旧前端/手工连接）一律按不同客户端处理，宁可直接拒绝也不误顶别人。
func sameClient(a, b *Session) bool {
	return a != nil && b != nil && a.clientID != "" && a.clientID == b.clientID
}

// Reserve 在拨号前占位。prev 非 nil 表示同一标签页的旧会话，调用方应在拨号成功后
// 通过 Commit 取得 prev 并结束它；ok=false 表示同名在线/正在登录，应拒绝新登录。
func (r *SessionRegistry) Reserve(key string, next *Session) (prev *Session, ok bool) {
	if r == nil || key == "" {
		return nil, true
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	entry := r.entries[key]
	if entry == nil {
		r.entries[key] = &registryEntry{pending: next}
		return nil, true
	}
	if entry.pending != nil {
		return nil, false
	}
	if entry.owner == nil {
		entry.pending = next
		return nil, true
	}
	if entry.owner == next {
		return nil, true
	}
	if sameClient(entry.owner, next) {
		entry.pending = next
		entry.owner.takeoverPending.Store(true)
		return entry.owner, true
	}
	// 已有其他标签页/客户端使用这个昵称：旧会话保持在线，新登录被拒绝。
	return nil, false
}

// Commit 把 pending 提升为 owner，返回旧 owner（仅同 clientID 重连时非 nil）。
func (r *SessionRegistry) Commit(key string, next *Session) *Session {
	if r == nil || key == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	entry := r.entries[key]
	if entry == nil {
		r.entries[key] = &registryEntry{owner: next}
		return nil
	}
	prev := entry.owner
	entry.owner = next
	if entry.pending == next {
		entry.pending = nil
	}
	return prev
}

// Release 在拨号失败时释放占位；旧 owner（如果有）恢复。
func (r *SessionRegistry) Release(key string, next *Session) {
	if r == nil || key == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	entry := r.entries[key]
	if entry == nil {
		return
	}
	if entry.pending == next {
		entry.pending = nil
		if entry.owner != nil {
			entry.owner.takeoverPending.Store(false)
		}
	}
	if entry.owner == nil && entry.pending == nil {
		delete(r.entries, key)
	}
}

// Unregister 会话清理时移除自己；只在仍是 owner/pending 时生效。
func (r *SessionRegistry) Unregister(key string, s *Session) {
	if r == nil || key == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	entry := r.entries[key]
	if entry == nil {
		return
	}
	if entry.pending == s {
		entry.pending = nil
		if entry.owner != nil {
			entry.owner.takeoverPending.Store(false)
		}
	}
	if entry.owner == s {
		entry.owner = nil
	}
	if entry.owner == nil && entry.pending == nil {
		delete(r.entries, key)
	}
}

// TakeoverPending 判断 s 是否正在被同一 clientID 的新会话接管
// （用于把 kicked 归一为 session_takeover）。
func (r *SessionRegistry) TakeoverPending(key string, s *Session) bool {
	if r == nil || key == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	entry := r.entries[key]
	return entry != nil && entry.owner == s && entry.pending != nil
}
