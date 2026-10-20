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

func newInviteSession(st *invite.Store) *Session {
	return &Session{
		done:             make(chan struct{}),
		send:             make(chan Envelope, 4),
		startedAt:        time.Now(),
		invites:          st,
		webInviteEnabled: true,
		synced:           true,
		serverPassword:   "server-pw",
		serverAddr:       "mumble.example.com",
		inviteURL: func(token string) string {
			return "https://chat.example.com/invite/" + token
		},
	}
}

func readEnvelope(t *testing.T, s *Session) Envelope {
	t.Helper()
	select {
	case env := <-s.send:
		return env
	case <-time.After(time.Second):
		t.Fatal("等待下行信封超时")
		return Envelope{}
	}
}

func TestCreateInviteNormalSession(t *testing.T) {
	st := invite.NewStore(time.Minute)
	s := newInviteSession(st)

	s.handleCreateInvite()
	env := readEnvelope(t, s)

	if env.Type != DownInvite {
		t.Fatalf("type: got %q want %q (code=%q reason=%q)", env.Type, DownInvite, env.Code, env.Reason)
	}
	if env.Token == "" || env.URL != "https://chat.example.com/invite/"+env.Token {
		t.Fatalf("邀请 token/url 错误: token=%q url=%q", env.Token, env.URL)
	}
	if env.ExpiresAt <= time.Now().Unix() {
		t.Fatalf("expiresAt 应在未来: %d", env.ExpiresAt)
	}
	if env.Password != "" {
		t.Fatal("邀请下行不得携带密码")
	}
	if st.Len() != 1 {
		t.Fatalf("应产生一条邀请记录，实际 %d", st.Len())
	}

	inv, ok := st.Claim(env.Token)
	if !ok {
		t.Fatal("新建邀请应可认领")
	}
	if inv.ServerAddr != "mumble.example.com" || inv.Password != "server-pw" {
		t.Fatalf("邀请应使用当前会话的上游与密码: %+v", inv)
	}
}

func TestCreateInviteRejectsInvitedResumeSession(t *testing.T) {
	st := invite.NewStore(time.Minute)
	s := newInviteSession(st)
	s.invited = true // 邀请登录与 resume 登录都会置位

	s.handleCreateInvite()
	env := readEnvelope(t, s)

	if env.Type != DownInviteError || env.Code != "invite_forbidden" {
		t.Fatalf("受邀用户应被拒绝: %+v", env)
	}
	if st.Len() != 0 {
		t.Fatalf("被拒时不得产生邀请记录，实际 %d", st.Len())
	}
}

func TestCreateInviteRejectsNotReady(t *testing.T) {
	st := invite.NewStore(time.Minute)
	s := newInviteSession(st)
	s.synced = false

	s.handleCreateInvite()
	env := readEnvelope(t, s)
	if env.Type != DownInviteError || env.Code != "invite_not_ready" {
		t.Fatalf("未同步时应拒绝: %+v", env)
	}
	if st.Len() != 0 {
		t.Fatalf("被拒时不得产生邀请记录，实际 %d", st.Len())
	}
}

func TestCreateInviteRejectsDisabled(t *testing.T) {
	st := invite.NewStore(time.Minute)
	s := newInviteSession(st)
	s.webInviteEnabled = false

	s.handleCreateInvite()
	env := readEnvelope(t, s)
	if env.Type != DownInviteError || env.Code != "invite_unavailable" {
		t.Fatalf("功能关闭时应拒绝: %+v", env)
	}
	if st.Len() != 0 {
		t.Fatalf("被拒时不得产生邀请记录，实际 %d", st.Len())
	}
}

// TestMarkSyncedInvitedSticky 验证 OnConnect 落权限，且同一 WS 二次普通 connect
// 不会把 invited 洗掉；cleanup 同时清空密码与权限。
func TestMarkSyncedInvitedSticky(t *testing.T) {
	s := &Session{done: make(chan struct{})}
	s.markSynced(&connectCreds{password: "first-pw", serverAddr: "one.example.com", trusted: true})
	if !s.invited || !s.synced || !s.connected {
		t.Fatal("邀请登录同步后应置 invited/synced/connected")
	}
	if s.serverPassword != "first-pw" || s.serverAddr != "one.example.com" {
		t.Fatal("同步后应保存本次会话凭据")
	}

	s.markSynced(&connectCreds{password: "second-pw", serverAddr: "two.example.com", trusted: false})
	if !s.invited {
		t.Fatal("受邀会话再次普通 connect 后 invited 仍应为 true")
	}
	if s.serverPassword != "second-pw" || s.serverAddr != "two.example.com" {
		t.Fatal("普通 connect 的凭据应更新到当前会话")
	}

	s.cleanup()
	if s.invited || s.synced || s.connected || s.serverPassword != "" || s.serverAddr != "" {
		t.Fatalf("cleanup 应清空邀请权限与凭据: %+v", s)
	}
}
