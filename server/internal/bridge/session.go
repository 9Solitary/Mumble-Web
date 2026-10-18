package bridge

import (
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"

	"mumbleweb/server/internal/gumble"
	"mumbleweb/server/internal/invite"
	"mumbleweb/server/internal/mumbleconn"
)

// Session 表示一个浏览器 WebSocket 连接对应的完整会话：
// 一个 gumble.Client（Mumble 登录）+ 一个 WebRTC PeerConnection（语音）。
type Session struct {
	ws   *websocket.Conn
	send chan Envelope
	done chan struct{}

	sid       string    // 随机会话标识，日志与诊断上报按它关联
	version   string    // 构建版本（hello 下发，便于前后端日志对照）
	startedAt time.Time // 会话开始时间（uptime_s 日志字段）

	upstream      mumbleconn.Target
	allowOverride bool // 允许浏览器在 connect 时指定其他上游服务器

	invites     *invite.Store // 一次性邀请存储（nil 表示邀请功能未启用）
	inviteToken string        // 本会话认领的邀请 token，会话结束时作废

	mu        sync.Mutex
	client    *gumble.Client
	rtc       *rtcPeer
	connected bool

	pttActive atomic.Bool
	voiceSeq  int64

	// talking 状态跟踪：session -> 最近一次收到语音帧的时间
	talkingMu   sync.Mutex
	lastVoice   map[uint32]time.Time
	talking     map[uint32]bool
	voiceFrames map[uint32]int

	// 语音链路诊断计数
	micPkts atomic.Int64 // 浏览器->代理 RTP 包数
	micFwd  atomic.Int64 // 代理->Mumble 转发帧数

	rtcUDPPort int
	publicIP   string
	udpMux     ice.UDPMux
}

func NewSession(ws *websocket.Conn, upstream mumbleconn.Target, udpMux ice.UDPMux, publicIP string, allowOverride bool, invites *invite.Store, sid, version string) *Session {
	return &Session{
		ws:            ws,
		send:          make(chan Envelope, 256),
		done:          make(chan struct{}),
		sid:           sid,
		version:       version,
		startedAt:     time.Now(),
		upstream:      upstream,
		allowOverride: allowOverride,
		invites:       invites,
		lastVoice:     make(map[uint32]time.Time),
		talking:       make(map[uint32]bool),
		voiceFrames:   make(map[uint32]int),
		udpMux:        udpMux,
		publicIP:      publicIP,
	}
}

// logEvent 以统一字段输出会话级结构化日志：sid + event + 会话存活秒数。
func (s *Session) logEvent(event string, args ...any) {
	attrs := make([]any, 0, len(args)+6)
	attrs = append(attrs, "sid", s.sid, "event", event, "uptime_s", int64(time.Since(s.startedAt).Seconds()))
	attrs = append(attrs, args...)
	slog.Info(event, attrs...)
}

// recoverGo 会话内 goroutine 的 panic 兜底：记录堆栈并清理会话，不拖垮整个进程。
func (s *Session) recoverGo(goroutine string) {
	if r := recover(); r != nil {
		slog.Error("panic", "sid", s.sid, "event", "panic", "goroutine", goroutine,
			"error", fmt.Sprint(r), "stack", string(debug.Stack()))
		s.cleanup()
	}
}

// Run 启动写泵与读循环，阻塞直到会话结束。
func (s *Session) Run() {
	defer s.cleanup()
	defer func() { s.recoverGo("run") }()

	s.logEvent("session_start", "remote", s.ws.RemoteAddr().String())
	s.push(Envelope{
		Type:    DownHello,
		SID:     s.sid,
		Version: s.version,
		Server: &ServerInfoPayload{
			Address:  s.upstream.Original,
			Resolved: s.upstream.Address,
			TLSMode:  s.upstream.TLSMode,
			Voice:    "tcp-tunnel",
		},
	})

	go s.writePump()
	go s.talkingWatchdog()

	for {
		var env Envelope
		if err := s.ws.ReadJSON(&env); err != nil {
			// 尽量提取 WS 关闭码，区分浏览器正常关闭与中间设备掐断
			code := 0
			closeText := ""
			var ce *websocket.CloseError
			if errors.As(err, &ce) {
				code = ce.Code
				closeText = ce.Text
			}
			s.logEvent("ws_close", "code", code, "reason", closeText, "error", err.Error())
			return
		}
		s.handle(env)
	}
}

func (s *Session) push(env Envelope) {
	select {
	case s.send <- env:
	case <-s.done:
	default:
		s.logEvent("send_buffer_full", "dropped", env.Type)
	}
}

func (s *Session) writePump() {
	defer func() { s.recoverGo("writePump") }()
	for {
		select {
		case env := <-s.send:
			if err := s.ws.WriteJSON(env); err != nil {
				return
			}
		case <-s.done:
			return
		}
	}
}

func (s *Session) cleanup() {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rtc != nil {
		s.rtc.Close()
	}
	if s.client != nil {
		s.client.Disconnect()
	}
	if s.inviteToken != "" && s.invites != nil {
		// 会话结束（退出登录/断线）：一次性邀请立即作废
		s.invites.Delete(s.inviteToken)
		s.inviteToken = ""
	}
}

// ---- 上行命令分发 ----

func (s *Session) handle(env Envelope) {
	switch env.Type {
	case UpConnect:
		s.handleConnect(env)
	case UpJoinChannel:
		s.withClient(func(c *gumble.Client) {
			if ch := c.Channels[env.ChannelID]; ch != nil && c.Self != nil {
				c.Self.Move(ch)
			}
		})
	case UpSendText:
		s.withClient(func(c *gumble.Client) {
			ch := c.Channels[env.ChannelID]
			if ch == nil {
				return
			}
			c.Send(&gumble.TextMessage{Channels: []*gumble.Channel{ch}, Message: env.Message})
			// Murmur 广播频道消息时会把发送者本人排除在接收列表之外，
			// 因此这里本地回显一条 DownText，让发送方网页能看到自己发的消息。
			payload := &TextPayload{
				ChannelIDs: []uint32{ch.ID},
				Message:    env.Message,
				Time:       time.Now().Unix(),
			}
			if c.Self != nil {
				payload.Sender = c.Self.Session
				payload.SenderName = c.Self.Name
			}
			s.push(Envelope{Type: DownText, Text: payload})
		})
	case UpSelfMute:
		s.withClient(func(c *gumble.Client) {
			if env.Mute != nil && c.Self != nil {
				c.Self.SetSelfMuted(*env.Mute)
			}
		})
	case UpSelfDeaf:
		s.withClient(func(c *gumble.Client) {
			if env.Deaf != nil && c.Self != nil {
				c.Self.SetSelfDeafened(*env.Deaf)
			}
		})
	case UpPtt:
		if env.Active != nil {
			s.logEvent("ptt", "active", *env.Active)
			wasActive := s.pttActive.Swap(*env.Active)
			if wasActive && !*env.Active {
				// 松开按键：补发一个带终止位的空语音包，告知服务器本次发言结束
				s.withClient(func(c *gumble.Client) {
					seq := atomic.AddInt64(&s.voiceSeq, 1)
					if err := c.Conn.WriteAudio(byte(4), 0, seq, true, nil, nil, nil, nil); err != nil {
						s.logEvent("mic_terminator_error", "error", err.Error())
					}
				})
			}
		}
	case "rtcOffer": // 浏览器初始 offer（携带 mic track）
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.HandleOffer(env.SDP); err != nil {
				s.logEvent("rtc_error", "op", "offer", "error", err.Error())
			}
		}
	case UpRtcAnswer:
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.HandleAnswer(env.SDP); err != nil {
				s.logEvent("rtc_error", "op", "answer", "error", err.Error())
			}
		}
	case UpRtcIce:
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.AddCandidate(env.Candidate, env.SDPMid); err != nil {
				s.logEvent("rtc_error", "op", "candidate", "error", err.Error())
			}
		}
	case UpDisconnect:
		s.cleanup()
	}
}

func (s *Session) withClient(f func(*gumble.Client)) {
	s.mu.Lock()
	c := s.client
	s.mu.Unlock()
	if c != nil {
		f(c)
	}
}

// ---- Mumble 连接 ----

// handleConnect 分发 connect 命令：携带 inviteToken 时走一次性邀请通道，
// 服务器/密码以服务端存储为准，忽略客户端提交的对应字段。
func (s *Session) handleConnect(env Envelope) {
	if env.InviteToken == "" {
		s.connectMumble(env.Username, env.Password, env.ServerAddr, false, "")
		return
	}
	if s.invites == nil {
		s.push(Envelope{Type: DownReject, Reason: "邀请功能未启用"})
		return
	}
	inv, ok := s.invites.Claim(env.InviteToken)
	if !ok {
		s.push(Envelope{Type: DownReject, Reason: "邀请链接无效或已被使用"})
		return
	}
	s.logEvent("invite_claim", "token", env.InviteToken[:8], "username", env.Username)
	s.connectMumble(env.Username, inv.Password, inv.ServerAddr, true, inv.Token)
}

func (s *Session) connectMumble(username, password, serverAddr string, trusted bool, inviteToken string) {
	// 登录失败时释放邀请认领，允许 TTL 内重试
	releaseInvite := func() {
		if inviteToken != "" && s.invites != nil {
			s.invites.Release(inviteToken)
		}
	}

	if username == "" {
		username = "web-guest"
	}

	upstream := s.upstream
	if serverAddr != "" && serverAddr != upstream.Original {
		if !trusted && !s.allowOverride {
			releaseInvite()
			s.push(Envelope{Type: DownReject, Reason: "该代理不允许自选服务器"})
			return
		}
		// 浏览器（或邀请）指定了其他上游：按代理的 TLS 策略（含 pin）重新解析
		t, err := mumbleconn.Resolve(serverAddr, upstream.TLSMode)
		if err != nil {
			releaseInvite()
			s.push(Envelope{Type: DownReject, Reason: "服务器地址解析失败: " + err.Error()})
			return
		}
		s.logEvent("upstream_override", "original", t.Original, "resolved", t.Address, "default", upstream.Original)
		upstream = t
	}

	// 先建 WebRTC 连接（语音桥），再做 Mumble 登录
	rtc, err := newRTCPeer(s.udpMux, s.publicIP, s.push, s.logEvent)
	if err != nil {
		releaseInvite()
		s.push(Envelope{Type: DownError, Reason: "WebRTC 初始化失败: " + err.Error()})
		return
	}
	rtc.SetMicHandler(s.onMicFrame)

	config := gumble.NewConfig()
	config.Username = username
	config.Password = password
	listener := &mumbleListener{s: s}
	config.Attach(listener)

	client, err := mumbleconn.Dial(upstream, config)
	if err != nil {
		rtc.Close()
		releaseInvite()
		s.logEvent("mumble_connect_failed", "username", username, "error", err.Error())
		s.push(Envelope{Type: DownReject, Reason: err.Error()})
		return
	}
	s.logEvent("mumble_connect", "username", username)
	client.RawVoiceHandler = s.onVoicePacket

	s.mu.Lock()
	s.client = client
	s.rtc = rtc
	s.connected = true
	s.inviteToken = inviteToken
	s.mu.Unlock()
}

// onVoicePacket 收到 Mumble 语音包（gumble 读协程调用，禁止阻塞）。
func (s *Session) onVoicePacket(packet []byte) {
	ParseVoicePacket(packet, func(f VoiceFrame) bool {
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.WriteVoice(f.Session, f.Data); err != nil {
				s.logEvent("voice_write_error", "error", err.Error())
			}
		}
		s.talkingMu.Lock()
		s.voiceFrames[f.Session]++
		n := s.voiceFrames[f.Session]
		s.talkingMu.Unlock()
		if n%50 == 1 {
			s.logEvent("voice_stats", "direction", "mumble->rtc", "mumble_session", f.Session, "frames", n, "bytes", len(f.Data))
		}
		s.markTalking(f.Session)
		return true
	})
}

// onMicFrame 浏览器麦克风 Opus 帧 -> 转发到 Mumble（PTT 门控）。
func (s *Session) onMicFrame(opus []byte) {
	pkts := s.micPkts.Add(1)
	if !s.pttActive.Load() {
		if pkts%50 == 1 {
			s.logEvent("mic_stats", "direction", "browser->proxy", "pkts", pkts, "forwarded", false)
		}
		return
	}
	s.mu.Lock()
	c := s.client
	s.mu.Unlock()
	if c == nil {
		return
	}
	seq := atomic.AddInt64(&s.voiceSeq, 1)
	// final=false：发言进行中，终止位只在松键时由空包携带（见 UpPtt 处理）
	if err := c.Conn.WriteAudio(byte(4), 0, seq, false, opus, nil, nil, nil); err != nil {
		s.logEvent("mic_forward_error", "error", err.Error())
	}
	if fwd := s.micFwd.Add(1); fwd%50 == 1 {
		s.logEvent("mic_stats", "direction", "proxy->mumble", "fwd", fwd, "bytes", len(opus))
	}
}

// ---- talking 状态 ----

func (s *Session) markTalking(session uint32) {
	s.talkingMu.Lock()
	s.lastVoice[session] = time.Now()
	if !s.talking[session] {
		s.talking[session] = true
		s.push(Envelope{Type: DownTalking, Talking: &TalkingPayload{Session: session, Talking: true}})
	}
	s.talkingMu.Unlock()
}

func (s *Session) talkingWatchdog() {
	defer func() { s.recoverGo("talkingWatchdog") }()
	t := time.NewTicker(150 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-s.done:
			return
		case now := <-t.C:
			s.talkingMu.Lock()
			for sess, talking := range s.talking {
				if talking && now.Sub(s.lastVoice[sess]) > 350*time.Millisecond {
					s.talking[sess] = false
					s.push(Envelope{Type: DownTalking, Talking: &TalkingPayload{Session: sess, Talking: false}})
				}
			}
			s.talkingMu.Unlock()
		}
	}
}

func userPayload(u *gumble.User) *UserPayload {
	channelID := uint32(0)
	if u.Channel != nil {
		channelID = u.Channel.ID
	}
	return &UserPayload{
		Session:         u.Session,
		Name:            u.Name,
		ChannelID:       channelID,
		Muted:           u.Muted,
		Deafened:        u.Deafened,
		Suppressed:      u.Suppressed,
		SelfMuted:       u.SelfMuted,
		SelfDeafened:    u.SelfDeafened,
		PrioritySpeaker: u.PrioritySpeaker,
		Registered:      u.UserID > 0,
		Comment:         u.Comment,
	}
}

func channelPayload(ch *gumble.Channel) *ChannelPayload {
	parentID := int64(-1)
	if ch.Parent != nil {
		parentID = int64(ch.Parent.ID)
	}
	return &ChannelPayload{
		ID:          ch.ID,
		ParentID:    parentID,
		Name:        ch.Name,
		Description: ch.Description,
		Position:    ch.Position,
		Temporary:   ch.Temporary,
	}
}

// ---- gumble 事件监听（在 gumble 读协程触发，必须非阻塞） ----

type mumbleListener struct {
	s *Session
}

func (l *mumbleListener) OnConnect(e *gumble.ConnectEvent) {
	s := l.s
	self := e.Client.Self
	if self == nil {
		s.logEvent("mumble_sync_error", "reason", "未收到自己的用户信息")
		s.push(Envelope{Type: DownError, Reason: "服务器同步异常：未收到自己的用户信息"})
		return
	}
	s.logEvent("mumble_synced", "mumble_session", self.Session, "username", self.Name,
		"channels", len(e.Client.Channels), "users", len(e.Client.Users))
	payload := &SelfPayload{Session: self.Session, Name: self.Name}
	if e.WelcomeMessage != nil {
		payload.WelcomeMessage = *e.WelcomeMessage
	}
	s.push(Envelope{Type: DownConnected, Self: payload})

	// 同步完成后推送全量频道与用户快照
	for _, ch := range e.Client.Channels {
		s.push(Envelope{Type: DownChannel, Channel: channelPayload(ch)})
	}
	for _, u := range e.Client.Users {
		s.push(Envelope{Type: DownUser, User: userPayload(u)})
	}
	s.push(Envelope{Type: DownSynced})
}

func (l *mumbleListener) OnDisconnect(e *gumble.DisconnectEvent) {
	reason := e.String
	if reason == "" {
		reason = "与服务器断开连接"
	}
	l.s.logEvent("mumble_disconnect", "reason", reason)
	l.s.push(Envelope{Type: DownDisconnect, Reason: reason})
}

func (l *mumbleListener) OnTextMessage(e *gumble.TextMessageEvent) {
	payload := &TextPayload{Message: e.Message, Time: time.Now().Unix()}
	if e.Sender != nil {
		payload.Sender = e.Sender.Session
		payload.SenderName = e.Sender.Name
	}
	for _, ch := range e.Channels {
		payload.ChannelIDs = append(payload.ChannelIDs, ch.ID)
	}
	for _, ch := range e.Trees {
		payload.ChannelIDs = append(payload.ChannelIDs, ch.ID)
	}
	l.s.push(Envelope{Type: DownText, Text: payload})
}

func (l *mumbleListener) OnUserChange(e *gumble.UserChangeEvent) {
	if e.Type == gumble.UserChangeDisconnected {
		l.s.push(Envelope{Type: DownUserDel, Session: e.User.Session})
		l.s.mu.Lock()
		rtc := l.s.rtc
		l.s.mu.Unlock()
		if rtc != nil {
			rtc.RemoveVoice(e.User.Session)
		}
		return
	}
	l.s.push(Envelope{Type: DownUser, User: userPayload(e.User)})
}

func (l *mumbleListener) OnChannelChange(e *gumble.ChannelChangeEvent) {
	if e.Type == gumble.ChannelChangeRemoved {
		l.s.push(Envelope{Type: DownChannelDel, ChannelID: e.Channel.ID})
		return
	}
	l.s.push(Envelope{Type: DownChannel, Channel: channelPayload(e.Channel)})
}

func (l *mumbleListener) OnPermissionDenied(e *gumble.PermissionDeniedEvent) {
	l.s.push(Envelope{Type: DownDenied, Reason: e.String})
}

func (l *mumbleListener) OnUserList(e *gumble.UserListEvent)               {}
func (l *mumbleListener) OnACL(e *gumble.ACLEvent)                         {}
func (l *mumbleListener) OnBanList(e *gumble.BanListEvent)                 {}
func (l *mumbleListener) OnContextActionChange(e *gumble.ContextActionChangeEvent) {
}
func (l *mumbleListener) OnServerConfig(e *gumble.ServerConfigEvent) {
	payload := &ConfigPayload{}
	if e.MaximumMessageLength != nil {
		payload.MaxMessageLength = *e.MaximumMessageLength
	}
	if e.MaximumImageMessageLength != nil {
		payload.MaxImageMessageLength = *e.MaximumImageMessageLength
	}
	l.s.push(Envelope{Type: DownConfig, Config: payload})
}
