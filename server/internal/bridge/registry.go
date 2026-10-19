package bridge

import "sync"

// SessionRegistry 保证同一个 (上游服务器, 昵称) 在代理内部只有一个活跃会话。
//
// 语义：
//   - Reserve：拨号前占位。已有 owner 时把它标记为“正在被接管”，并允许新会话拨号；
//     旧会话暂时不断开，这样新连接密码错误时不会误踢旧用户。
//   - Commit：新会话拨号成功后调用，返回旧 owner，由调用方结束旧会话。
//   - Release：拨号失败时释放占位，旧会话恢复正常。
//   - Unregister：会话清理时移除自己（仅当自己仍是 owner/pending）。
//
// Murmur 自身也会在新登录时踢掉旧会话；registry 的作用是把“踢”变成确定性的、
// 可通知前端停止重连的 session_takeover，避免两个页面互相顶。
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

// Reserve 在拨号前占位。prev 非 nil 表示已有会话，调用方应在拨号成功后
// 通过 Commit 取得 prev 并结束它；ok=false 表示已有另一个新会话正在拨号。
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
	entry.pending = next
	entry.owner.takeoverPending.Store(true)
	return entry.owner, true
}

// Commit 把 pending 提升为 owner，返回旧 owner。
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

// TakeoverPending 判断 s 是否正在被另一个新会话接管（用于把 kicked 归一为 takeover）。
func (r *SessionRegistry) TakeoverPending(key string, s *Session) bool {
	if r == nil || key == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	entry := r.entries[key]
	return entry != nil && entry.owner == s && entry.pending != nil
}
