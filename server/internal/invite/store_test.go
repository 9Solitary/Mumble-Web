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

func TestCreateTokenAndClaim(t *testing.T) {
	const ttl = 30 * time.Minute
	st := NewStore(ttl)
	before := time.Now()

	inv, err := st.Create("mumble.example.com", "server-pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(inv.Token) != 43 {
		t.Fatalf("32 字节随机数的 base64url token 应为 43 字符，实际 %d", len(inv.Token))
	}
	if strings.ContainsAny(inv.Token, "+/=") {
		t.Fatalf("token 必须是 URL 安全字符: %q", inv.Token)
	}
	if inv.ServerAddr != "mumble.example.com" || inv.Password != "server-pw" {
		t.Fatalf("邀请应保存创建时的服务器与密码: %+v", inv)
	}
	if inv.Claimed {
		t.Fatal("新建邀请不应处于已认领状态")
	}
	if inv.ExpiresAt.Before(before.Add(ttl-time.Second)) || inv.ExpiresAt.After(time.Now().Add(ttl+time.Second)) {
		t.Fatalf("邀请有效期错误: %s", inv.ExpiresAt)
	}
	if !st.Validate(inv.Token) {
		t.Fatal("新建邀请应可校验")
	}
	if st.Len() != 1 {
		t.Fatalf("Len 应为 1，实际 %d", st.Len())
	}

	claimed, ok := st.Claim(inv.Token)
	if !ok || claimed != inv {
		t.Fatalf("首次 Claim 应成功并返回同一邀请: ok=%v", ok)
	}
	if st.Validate(inv.Token) {
		t.Fatal("认领后邀请不应再通过校验")
	}
	if _, ok := st.Claim(inv.Token); ok {
		t.Fatal("同一邀请不能被认领两次")
	}
}

func TestReleaseAllowsRetry(t *testing.T) {
	st := NewStore(time.Minute)
	inv, err := st.Create("", "pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, ok := st.Claim(inv.Token); !ok {
		t.Fatal("首次 Claim 应成功")
	}
	st.Release(inv.Token)
	if !st.Validate(inv.Token) {
		t.Fatal("Release 后邀请应重新可校验")
	}
	if _, ok := st.Claim(inv.Token); !ok {
		t.Fatal("Release 后应允许再次认领")
	}
}

func TestCreateInviteExpires(t *testing.T) {
	st := NewStore(time.Minute)
	inv, err := st.Create("", "pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	st.mu.Lock()
	inv.ExpiresAt = time.Now().Add(-time.Second)
	st.mu.Unlock()

	if st.Validate(inv.Token) {
		t.Fatal("过期邀请不应通过校验")
	}
	if _, ok := st.Claim(inv.Token); ok {
		t.Fatal("过期邀请不应可认领")
	}
}

func TestDeleteRemovesInvite(t *testing.T) {
	st := NewStore(time.Minute)
	inv, err := st.Create("", "pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	st.Delete(inv.Token)
	if st.Validate(inv.Token) {
		t.Fatal("Delete 后邀请不应可校验")
	}
	if st.Len() != 0 {
		t.Fatalf("Delete 后 Len 应为 0，实际 %d", st.Len())
	}
}
