package bridge

import (
	"sync"
	"testing"
	"time"

	"mumbleweb/server/internal/invite"
)

// TestGapStatsRecord 验证间隔统计：正常间隔计入、突发计数、静默期不计入、均值。
// 帧到达间隔与写调用间隔共用 gapStats，一处覆盖即可。
func TestGapStatsRecord(t *testing.T) {
	st := &gapStats{}
	if st.avg() != 0 {
		t.Fatal("无样本时均值应为 0")
	}

	// 连续语音：20ms 正常帧间隔
	for i := 0; i < 10; i++ {
		st.record(20)
	}
	if st.gapN != 10 || st.maxGap != 20 || st.bursts != 0 {
		t.Fatalf("正常间隔: gapN=%d maxGap=%d bursts=%d，预期 10/20/0", st.gapN, st.maxGap, st.bursts)
	}

	// 150ms 间隔：计入且算一次突发
	st.record(150)
	if st.gapN != 11 || st.maxGap != 150 || st.bursts != 1 {
		t.Fatalf("突发: gapN=%d maxGap=%d bursts=%d，预期 11/150/1", st.gapN, st.maxGap, st.bursts)
	}

	// 600ms 间隔：视为说话间隙，不计入统计
	st.record(600)
	if st.gapN != 11 || st.maxGap != 150 || st.bursts != 1 {
		t.Fatalf("静默期不应计入: gapN=%d maxGap=%d bursts=%d", st.gapN, st.maxGap, st.bursts)
	}

	if avg := st.avg(); avg != (20*10+150)/11 {
		t.Fatalf("gap 均值错误: %d", avg)
	}
}

// TestCleanupIdempotent 模拟 WS 读错误 / Mumble 断开 / 前端主动 disconnect
// 并发触发清理：不得 panic、不得重复关闭 channel、邀请只作废一次。
func TestCleanupIdempotent(t *testing.T) {
	st := invite.NewStore(time.Minute)
	inv, err := st.Create("", "pw")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, ok := st.Claim(inv.Token); !ok {
		t.Fatal("Claim 应成功")
	}

	// 不构造真实 ws/rtc/client：cleanup 不触碰 ws，nil rtc/client 走空分支
	s := &Session{
		done:        make(chan struct{}),
		send:        make(chan Envelope, 16),
		invites:     st,
		inviteToken: inv.Token,
	}

	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.cleanup()
			s.cleanup()
		}()
	}
	wg.Wait()

	select {
	case <-s.done:
	default:
		t.Fatal("done 应已关闭")
	}
	if st.Validate(inv.Token) {
		t.Fatal("认领的邀请应在清理后作废")
	}
	// 重复调用安全
	s.cleanup()
}

// TestCleanupKeepsResumeToken 异常断线的清理不得吊销 resume token，
// 否则断线重连时凭据已失效，恢复功能形同虚设。
func TestCleanupKeepsResumeToken(t *testing.T) {
	st := invite.NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	s := &Session{
		done:        make(chan struct{}),
		invites:     st,
		resumeToken: rt.Token,
	}
	s.cleanup()

	if _, ok := st.RedeemResume(rt.Token, "alice"); !ok {
		t.Fatal("异常清理不应吊销 resume token")
	}
}

// TestRevokeResumeOnUserDisconnect 用户主动退出时吊销 resume token，且重复调用安全。
func TestRevokeResumeOnUserDisconnect(t *testing.T) {
	st := invite.NewStore(time.Minute)
	rt, _ := st.IssueResume("alice", "", "pw")

	s := &Session{
		done:        make(chan struct{}),
		invites:     st,
		resumeToken: rt.Token,
	}
	s.revokeResume()
	if _, ok := st.RedeemResume(rt.Token, "alice"); ok {
		t.Fatal("主动退出后 resume token 应已吊销")
	}
	s.revokeResume() // 重复吊销不 panic

	// 没有 resume token 的会话调用也安全
	s2 := &Session{done: make(chan struct{}), invites: st}
	s2.revokeResume()
}
