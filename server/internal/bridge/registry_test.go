package bridge

import (
	"sync"
	"testing"
)

func TestSessionRegistryReserveCommit(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{}
	b := &Session{}
	const key = "server\x00alice"

	prev, ok := r.Reserve(key, a)
	if !ok || prev != nil {
		t.Fatalf("首次占位应成功且无旧会话: ok=%v prev=%v", ok, prev)
	}
	if _, ok := r.Reserve(key, b); ok {
		t.Fatal("同一 key 已有 pending 时，第二个新会话应被拒绝")
	}
	if got := r.Commit(key, a); got != nil {
		t.Fatalf("首次 Commit 不应返回旧 owner，得到 %v", got)
	}
	if r.TakeoverPending(key, a) {
		t.Fatal("a 已是 owner，不应处于被接管状态")
	}

	prev, ok = r.Reserve(key, b)
	if !ok || prev != a {
		t.Fatalf("同名新会话应拿到旧 owner: ok=%v prev=%v", ok, prev)
	}
	if !r.TakeoverPending(key, a) {
		t.Fatal("旧会话应标记为正在被接管")
	}

	got := r.Commit(key, b)
	if got != a {
		t.Fatalf("Commit 应返回旧 owner，得到 %v", got)
	}
	if r.TakeoverPending(key, b) {
		t.Fatal("新 owner 不应处于被接管状态")
	}
}

func TestSessionRegistryReleaseAndUnregister(t *testing.T) {
	r := NewSessionRegistry()
	a := &Session{}
	b := &Session{}
	const key = "server\x00bob"

	_, _ = r.Reserve(key, a)
	_ = r.Commit(key, a)

	// b 拨号失败：旧 owner a 应恢复，不被踢
	if _, ok := r.Reserve(key, b); !ok {
		t.Fatal("b 占位应成功")
	}
	r.Release(key, b)
	if r.TakeoverPending(key, a) {
		t.Fatal("Release 后旧会话不应再处于被接管状态")
	}

	// 清理 owner 后 key 可被重新占用
	r.Unregister(key, a)
	prev, ok := r.Reserve(key, b)
	if !ok || prev != nil {
		t.Fatalf("owner 清理后应可重新占位: ok=%v prev=%v", ok, prev)
	}
}

func TestSessionRegistryConcurrentReserve(t *testing.T) {
	r := NewSessionRegistry()
	const key = "server\x00carol"
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
