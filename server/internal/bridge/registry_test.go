package bridge

import (
	"sync"
	"testing"
)

func TestSessionRegistryRejectsDifferentClient(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{clientID: "tab-a"}
	b := &Session{clientID: "tab-b"}
	const key = "server\x00alice"

	prev, ok := r.Reserve(key, a)
	if !ok || prev != nil {
		t.Fatalf("首次占位应成功且无旧会话: ok=%v prev=%v", ok, prev)
	}
	if got := r.Commit(key, a); got != nil {
		t.Fatalf("首次 Commit 不应返回旧 owner，得到 %v", got)
	}

	// 不同标签页/客户端同名：必须拒绝，且旧会话不能被标记为接管。
	prev, ok = r.Reserve(key, b)
	if ok || prev != nil {
		t.Fatalf("不同 clientID 的同名登录应被拒绝: ok=%v prev=%v", ok, prev)
	}
	if r.TakeoverPending(key, a) {
		t.Fatal("被拒绝的新登录不应标记旧会话为正在被接管")
	}

	// 被拒绝后释放 b 不应影响 a。
	r.Release(key, b)
	if prev, ok = r.Reserve(key, b); ok || prev != nil {
		t.Fatalf("a 仍在线时 b 仍应被拒绝: ok=%v prev=%v", ok, prev)
	}
}

func TestSessionRegistryAllowsSameClientReconnect(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{clientID: "tab-a"}
	b := &Session{clientID: "tab-a"}
	const key = "server\x00alice"

	if _, ok := r.Reserve(key, a); !ok {
		t.Fatal("a 首次占位应成功")
	}
	_ = r.Commit(key, a)

	// 同一标签页刷新/断线重连：允许接管旧会话。
	prev, ok := r.Reserve(key, b)
	if !ok || prev != a {
		t.Fatalf("同 clientID 重连应拿到旧 owner: ok=%v prev=%v", ok, prev)
	}
	if !r.TakeoverPending(key, a) {
		t.Fatal("旧会话应标记为正在被同一标签页接管")
	}
	if got := r.Commit(key, b); got != a {
		t.Fatalf("Commit 应返回旧 owner，得到 %v", got)
	}
	if r.TakeoverPending(key, b) {
		t.Fatal("新 owner 不应处于被接管状态")
	}

	// 旧会话清理时不能误删新 owner。
	r.Unregister(key, a)
	if prev, ok = r.Reserve(key, &Session{clientID: "tab-other"}); ok || prev != nil {
		t.Fatalf("新 owner 仍在线时其他客户端应被拒绝: ok=%v prev=%v", ok, prev)
	}
}

func TestSessionRegistryRejectsWhilePending(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{clientID: "tab-a"}
	const key = "server\x00bob"

	if _, ok := r.Reserve(key, a); !ok {
		t.Fatal("a 首次占位应成功")
	}
	if _, ok := r.Reserve(key, &Session{clientID: "tab-b"}); ok {
		t.Fatal("已有 pending 时其他客户端应被拒绝")
	}
	if _, ok := r.Reserve(key, &Session{clientID: "tab-a"}); ok {
		t.Fatal("同一 clientID 的并发重复登录也应被拒绝")
	}

	// 释放 pending 后，其他客户端才能占位。
	r.Release(key, a)
	if _, ok := r.Reserve(key, &Session{clientID: "tab-b"}); !ok {
		t.Fatal("pending 释放后应允许新占位")
	}
}

func TestSessionRegistryReleaseAndUnregister(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{clientID: "tab-a"}
	b := &Session{clientID: "tab-b"}
	const key = "server\x00carol"

	_, _ = r.Reserve(key, a)
	_ = r.Commit(key, a)

	// owner 清理后 key 可被重新占用
	r.Unregister(key, a)
	prev, ok := r.Reserve(key, b)
	if !ok || prev != nil {
		t.Fatalf("owner 清理后应可重新占位: ok=%v prev=%v", ok, prev)
	}

	// 拨号失败释放占位后，key 也可被重新占用
	r.Release(key, b)
	if _, ok := r.Reserve(key, &Session{clientID: "tab-c"}); !ok {
		t.Fatal("pending 释放后应可重新占位")
	}
}

func TestSessionRegistryReleaseSameClientRestoresOwner(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{clientID: "tab-a"}
	b := &Session{clientID: "tab-a"}
	const key = "server\x00grace"

	_, _ = r.Reserve(key, a)
	_ = r.Commit(key, a)

	// 同一标签页重连拨号失败：释放占位后旧会话必须恢复，不能继续被标记为接管中。
	if _, ok := r.Reserve(key, b); !ok {
		t.Fatal("同 clientID 重连占位应成功")
	}
	if !r.TakeoverPending(key, a) {
		t.Fatal("重连拨号期间旧会话应标记为接管中")
	}
	r.Release(key, b)
	if r.TakeoverPending(key, a) {
		t.Fatal("释放后旧会话不应再处于接管状态")
	}
	if _, ok := r.Reserve(key, &Session{clientID: "tab-other"}); ok {
		t.Fatal("旧会话恢复后，其他客户端仍应被拒绝")
	}
}

func TestSessionRegistryEmptyClientNeverTakesOver(t *testing.T) {
	r := NewSessionRegistry()
	owner := &Session{clientID: "tab-a"}
	const key = "server\x00dave"

	_, _ = r.Reserve(key, owner)
	_ = r.Commit(key, owner)

	// 旧前端/手工连接不带 clientID：按不同客户端处理，直接拒绝。
	if _, ok := r.Reserve(key, &Session{}); ok {
		t.Fatal("空 clientID 不应接管已有会话")
	}

	// 两个空 clientID 之间也不能互相接管。
	r2 := NewSessionRegistry()
	owner2 := &Session{}
	_, _ = r2.Reserve("server\x00erin", owner2)
	_ = r2.Commit("server\x00erin", owner2)
	if _, ok := r2.Reserve("server\x00erin", &Session{}); ok {
		t.Fatal("空 clientID 之间也不应互相接管")
	}
}

func TestSessionRegistryConcurrentReserve(t *testing.T) {
	r := NewSessionRegistry()
	const key = "server\x00frank"
	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, ok := r.Reserve(key, &Session{}); ok {
				mu.Lock()
				granted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if granted != 1 {
		t.Fatalf("并发占位应只有一个成功，得到 %d", granted)
	}
}
