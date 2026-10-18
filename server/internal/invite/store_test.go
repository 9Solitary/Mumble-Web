package invite

import (
	"strings"
	"testing"
	"time"
)

func TestIssueAndRedeemResume(t *testing.T) {
	st := NewStore(time.Minute)

	rt, err := st.IssueResume("alice", "mumble.example.com", "secret")
	if err != nil {
		t.Fatalf("IssueResume: %v", err)
	}
	if len(rt.Token) != 32 {
		t.Fatalf("token 应为 32 字符 hex，实际 %d", len(rt.Token))
	}

	got, ok := st.RedeemResume(rt.Token, "alice")
	if !ok {
		t.Fatal("签发后应立即可兑换")
	}
	if got.Username != "alice" || got.ServerAddr != "mumble.example.com" || got.Password != "secret" {
		t.Fatalf("兑换返回的凭据与签发时不一致: %+v", got)
	}
	if !got.ExpiresAt.After(time.Now()) {
		t.Fatal("有效期应在未来")
	}
}

func TestRedeemResumeReusableWithinWindow(t *testing.T) {
	st := NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	// 窗口期内可重复兑换（指数退避重试需要多次使用）
	for i := 0; i < 3; i++ {
		if _, ok := st.RedeemResume(rt.Token, "alice"); !ok {
			t.Fatalf("第 %d 次重复兑换应成功", i+1)
		}
	}
}

func TestRedeemResumeUsernameMismatch(t *testing.T) {
	st := NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	if _, ok := st.RedeemResume(rt.Token, "bob"); ok {
		t.Fatal("username 不匹配应兑换失败")
	}
}

func TestRedeemResumeExpired(t *testing.T) {
	st := NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	// 直接改成已过期（同包测试可访问内部字段）
	st.mu.Lock()
	st.resume[rt.Token].ExpiresAt = time.Now().Add(-time.Second)
	st.mu.Unlock()

	if _, ok := st.RedeemResume(rt.Token, "alice"); ok {
		t.Fatal("过期 token 应兑换失败")
	}
}

func TestRevokeResume(t *testing.T) {
	st := NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	st.RevokeResume(rt.Token)
	if _, ok := st.RedeemResume(rt.Token, "alice"); ok {
		t.Fatal("吊销后应兑换失败")
	}
	// 重复吊销不应 panic
	st.RevokeResume(rt.Token)
}

func TestRedeemResumeUnknownToken(t *testing.T) {
	st := NewStore(time.Minute)
	if _, ok := st.RedeemResume(strings.Repeat("0", 32), "alice"); ok {
		t.Fatal("未知 token 应兑换失败")
	}
}

func TestResumeIndependentOfInviteLifecycle(t *testing.T) {
	st := NewStore(time.Minute)
	inv, err := st.Create("", "pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, ok := st.Claim(inv.Token); !ok {
		t.Fatal("Claim 应成功")
	}
	rt, _ := st.IssueResume("alice", "", "pw")

	// 会话结束删除原邀请后，resume token 仍应可用（两者生命周期独立）
	st.Delete(inv.Token)
	if _, ok := st.RedeemResume(rt.Token, "alice"); !ok {
		t.Fatal("原邀请作废后 resume token 应仍可用")
	}
}
