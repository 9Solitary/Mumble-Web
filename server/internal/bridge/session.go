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

// WS 心跳与写超时参数：
// 浏览器自动回 pong，前端无需任何心跳代码。
const (
	wsPingPeriod   = 25 * time.Second // 服务端 Ping 周期（小于常见的 60s 空闲掐断阈值）
	wsPongWait     = 90 * time.Second // 读死线：连续 90s 无任何消息（含 pong）判定断线
	wsWriteTimeout = 10 * time.Second // 单次写超时
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
	resumeToken string        // 本会话持有的断线恢复凭据，用户主动退出时吊销

	registry        *SessionRegistry // 同名会话注册表（nil = 不启用）
	sessionKey      string           // 上游地址 + 小写昵称
	clientID        string           // 同一浏览器标签页的稳定标识（用于区分重连与重名）
	takeoverPending atomic.Bool      // 有新会话正在拨号接管本会话

	mu        sync.Mutex
	client    *gumble.Client
	rtc       *rtcPeer
	connected bool

	cleanupOnce sync.Once    // 保证清理只执行一次（WS 错误/Mumble 断开/主动退出可能并发触发）
	wsMu        sync.Mutex   // 串行化 WS 写（writePump 与 closeWS 等控制帧写可能并发）
	closeCode   atomic.Int32 // 非 0 时 writePump 排空发送队列后按此码发 WS 关闭帧

	pttActive atomic.Bool
	voiceSeq  int64

	// talking 状态跟踪：session -> 最近一次收到语音帧的时间
	talkingMu   sync.Mutex
	lastVoice   map[uint32]time.Time
	talking     map[uint32]bool
	voiceFrames map[uint32]int

	// 下行语音到达间隔统计（mumble->rtc，观测 TCP 隧道是否有突发成串到达）
	downlink map[uint32]*downlinkStats

	// 语音链路诊断计数
	micPkts atomic.Int64 // 浏览器->代理 RTP 包数
	micFwd  atomic.Int64 // 代理->Mumble 转发帧数

	rtcUDPPort int
	publicIP   string
	udpMux     ice.UDPMux
}

func NewSession(ws *websocket.Conn, upstream mumbleconn.Target, udpMux ice.UDPMux, publicIP string, allowOverride bool, invites *invite.Store, registry *SessionRegistry, sid, version string) *Session {
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
		registry:      registry,
		lastVoice:     make(map[uint32]time.Time),
		talking:       make(map[uint32]bool),
		voiceFrames:   make(map[uint32]int),
		downlink:      make(map[uint32]*downlinkStats),
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

	// WS 心跳：读死线靠 pong 刷新（浏览器对 Ping 控制帧自动回 Pong）
	s.ws.SetReadDeadline(time.Now().Add(wsPongWait))
	s.ws.SetPongHandler(func(string) error {
		return s.ws.SetReadDeadline(time.Now().Add(wsPongWait))
	})

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
			// 尽量提取 WS 关闭码，区分浏览器正常关闭与中间设备掐断/读超时
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

// writeJSON 串行化 WS 数据写（带写超时）。
func (s *Session) writeJSON(env Envelope) error {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	_ = s.ws.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return s.ws.WriteJSON(env)
}

func (s *Session) writePump() {
	defer func() { s.recoverGo("writePump") }()
	ticker := time.NewTicker(wsPingPeriod)
	defer ticker.Stop()
	for {
		select {
		case env := <-s.send:
			if err := s.writeJSON(env); err != nil {
				s.logEvent("ws_write_error", "error", err.Error())
				s.cleanup()
				return
			}
		case <-ticker.C:
			s.wsMu.Lock()
			_ = s.ws.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			err := s.ws.WriteMessage(websocket.PingMessage, nil)
			s.wsMu.Unlock()
			if err != nil {
				s.logEvent("ws_ping_error", "error", err.Error())
				s.cleanup()
				return
			}
		case <-s.done:
			s.flushAndClose()
			return
		}
	}
}

// flushAndClose 会话结束时排空发送队列（保证 disconnected 等收尾信封送达），
// 若通过 requestClose 请求了关闭码则最后发送 WS 关闭帧。
func (s *Session) flushAndClose() {
	for {
		select {
		case env := <-s.send:
			if err := s.writeJSON(env); err != nil {
				return
			}
		default:
			if code := s.closeCode.Load(); code != 0 {
				s.wsMu.Lock()
				_ = s.ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(int(code), ""), time.Now().Add(wsWriteTimeout))
				s.wsMu.Unlock()
			}
			return
		}
	}
}

// requestClose 请求 writePump 在排空发送队列后以指定关闭码关闭 WS。
// 用于 Mumble 上游异常断开（1011），让前端区分异常断开并触发重连。
func (s *Session) requestClose(code int) {
	s.closeCode.Store(int32(code))
}

// wsCloseSessionEnded 是“不再自动重连”的自定义 WS 关闭码。
// 前端仍以 disconnected/reject 信封里的 code 为准；这个关闭码只用于日志与兜底。
const wsCloseSessionEnded = 4001

// endWith 结束本会话：推一条带 code 的 disconnected，排空后以 4001 关闭 WS。
// 用于同名接管、被踢/封禁等终止态；前端收到 code 后不会再自动重连。
func (s *Session) endWith(code, reason string) {
	if !s.closeCode.CompareAndSwap(0, wsCloseSessionEnded) {
		s.cleanup()
		return
	}
	s.logEvent("session_end", "code", code)
	s.push(Envelope{Type: DownDisconnect, Reason: reason, Code: code})
	s.cleanup()
}

// cleanup 幂等清理：关闭 rtc/上游连接、作废认领的邀请。
// WS 读错误、Mumble 断开、前端主动 disconnect 三条路径可能并发触发，sync.Once 保证只执行一次。
// 注意：resume token 不在此吊销——挂机断线后新会话还要凭它恢复；
// 只有用户主动退出（UpDisconnect）才吊销。
func (s *Session) cleanup() {
	s.cleanupOnce.Do(func() {
		close(s.done)
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.rtc != nil {
			s.rtc.Close()
			s.rtc = nil
		}
		if s.client != nil {
			s.client.Disconnect()
			s.client = nil
		}
		if s.registry != nil && s.sessionKey != "" {
			s.registry.Unregister(s.sessionKey, s)
		}
		if s.inviteToken != "" && s.invites != nil {
			// 会话结束（退出登录/断线）：一次性邀请立即作废
			s.invites.Delete(s.inviteToken)
			s.inviteToken = ""
		}
	})
}

// revokeResume 吊销本会话的断线恢复凭据（用户主动退出时调用）。
func (s *Session) revokeResume() {
	s.mu.Lock()
	token := s.resumeToken
	s.resumeToken = ""
	s.mu.Unlock()
	if token != "" && s.invites != nil {
		s.invites.RevokeResume(token)
		s.logEvent("resume_revoked")
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
		// 用户主动退出：吊销恢复凭据后走正常清理，服务端不再额外动作
		s.revokeResume()
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

// handleConnect 分发 connect 命令：
//   - 携带 resumeToken：断线恢复，服务器/密码从恢复凭据存储还原（username 须与签发时一致）
//   - 携带 inviteToken：一次性邀请通道，服务器/密码以服务端存储为准
//   - 否则：用户名+密码常规登录
func (s *Session) handleConnect(env Envelope) {
	// 同一标签页的重连会带同一个 clientId；不同标签页/不同人拿不到它。
	if env.ClientID != "" {
		s.clientID = env.ClientID
	}
	if env.ResumeToken != "" {
		if s.invites == nil {
			s.push(Envelope{Type: DownReject, Reason: "邀请功能未启用", Code: "invite_unavailable"})
			return
		}
		rt, ok := s.invites.RedeemResume(env.ResumeToken, env.Username)
		if !ok {
			s.push(Envelope{Type: DownReject, Reason: "恢复凭据无效或已过期，请重新使用邀请链接", Code: "resume_invalid"})
			return
		}
		s.logEvent("resume_redeem", "username", rt.Username)
		s.connectMumble(rt.Username, rt.Password, rt.ServerAddr, true, "")
		return
	}
	if env.InviteToken == "" {
		s.connectMumble(env.Username, env.Password, env.ServerAddr, false, "")
		return
	}
	if s.invites == nil {
		s.push(Envelope{Type: DownReject, Reason: "邀请功能未启用", Code: "invite_unavailable"})
		return
	}
	inv, ok := s.invites.Claim(env.InviteToken)
	if !ok {
		s.push(Envelope{Type: DownReject, Reason: "邀请链接无效或已被使用", Code: "invite_invalid"})
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
			s.push(Envelope{Type: DownReject, Reason: "该代理不允许自选服务器", Code: "server_override_denied"})
			return
		}
		// 浏览器（或邀请）指定了其他上游：按代理的 TLS 策略（含 pin）重新解析
		t, err := mumbleconn.Resolve(serverAddr, upstream.TLSMode)
		if err != nil {
			releaseInvite()
			s.push(Envelope{Type: DownReject, Reason: "服务器地址解析失败: " + err.Error(), Code: "server_unreachable"})
			return
		}
		s.logEvent("upstream_override", "original", t.Original, "resolved", t.Address, "default", upstream.Original)
		upstream = t
	}

	// 同名会话占位：已有其他标签页/客户端在线时直接拒绝，旧会话不受影响。
	// 同一 clientId（本标签页刷新/断线重连）仍走接管，避免正常重连被误判为重名。
	key := registryKey(upstream.Address, username)
	if s.registry != nil {
		if _, ok := s.registry.Reserve(key, s); !ok {
			releaseInvite()
			s.push(Envelope{Type: DownReject, Reason: "这个昵称已被占用，请换一个昵称", Code: "username_in_use"})
			return
		}
		s.sessionKey = key
	}
	releaseReservation := func() {
		if s.registry != nil && s.sessionKey != "" {
			s.registry.Release(s.sessionKey, s)
			s.sessionKey = ""
		}
	}

	// 先建 WebRTC 连接（语音桥），再做 Mumble 登录
	rtc, err := newRTCPeer(s.udpMux, s.publicIP, s.push, s.logEvent)
	if err != nil {
		releaseReservation()
		releaseInvite()
		s.push(Envelope{Type: DownError, Reason: "WebRTC 初始化失败: " + err.Error(), Code: "webrtc_failed"})
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
		releaseReservation()
		releaseInvite()
		s.logEvent("mumble_connect_failed", "username", username, "error", err.Error())
		s.push(Envelope{Type: DownReject, Reason: err.Error(), Code: mumbleRejectCode(err)})
		return
	}

	// 拨号成功：把占位提升为 owner，并结束被接管的旧会话。
	if s.registry != nil {
		if prev := s.registry.Commit(key, s); prev != nil {
			go prev.endWith("session_takeover", "another session signed in with this name")
		}
	}

	s.logEvent("mumble_connect", "username", username)
	client.RawVoiceHandler = s.onVoicePacket

	s.mu.Lock()
	s.client = client
	s.rtc = rtc
	s.connected = true
	s.inviteToken = inviteToken
	s.mu.Unlock()

	// 凭据来自服务端存储（一次性邀请或恢复凭据）的登录：签发断线恢复凭据。
	// Dial 返回时 OnConnect 已推送 connected/频道/用户/synced，
	// 此处下发 resume_token 满足「在 synced 之后」的契约顺序。
	if trusted && s.invites != nil {
		if rt, err := s.invites.IssueResume(username, serverAddr, password); err == nil {
			s.mu.Lock()
			s.resumeToken = rt.Token
			s.mu.Unlock()
			s.push(Envelope{Type: DownResumeToken, Token: rt.Token, ExpiresAt: rt.ExpiresAt.Unix()})
			s.logEvent("resume_issued")
		} else {
			s.logEvent("resume_issue_error", "error", err.Error())
		}
	}
}

// 下行语音观测阈值：
// 正常 Opus 帧间隔约 20ms（协商 ptime=10 时 10ms）；gap 超过 100ms 视为一次突发（成串到达），
// 超过 500ms 认为是一段发言结束后的停顿，不计入间隔统计（否则说话间隙会污染 max/突发计数）。
const (
	downlinkBurstGapMs   = 100
	downlinkSilenceGapMs = 500
)

// gapStats 是通用的间隔统计（帧到达间隔、写调用间隔共用同一口径）。
type gapStats struct {
	sumGap int64 // 有效间隔样本之和（ms）
	gapN   int   // 有效间隔样本数
	maxGap int64 // 最大间隔（ms）——head-of-line blocking 的直接证据
	bursts int   // gap > downlinkBurstGapMs 的突发次数
}

// record 记录一个间隔样本；超过静默阈值视为新一段发言的开始，不计入统计。
func (g *gapStats) record(gapMs int64) {
	if gapMs > downlinkSilenceGapMs {
		return
	}
	g.sumGap += gapMs
	g.gapN++
	if gapMs > g.maxGap {
		g.maxGap = gapMs
	}
	if gapMs > downlinkBurstGapMs {
		g.bursts++
	}
}

func (g *gapStats) avg() int64 {
	if g.gapN == 0 {
		return 0
	}
	return g.sumGap / int64(g.gapN)
}

// downlinkStats 是单路说话人（Mumble session）的下行语音统计。
// 只被 gumble 读协程写入，读取（日志）也在同一协程，无并发竞争。
type downlinkStats struct {
	last   time.Time // 上一帧到达时间
	frames int       // 累计帧数
	arrive gapStats  // 帧到达间隔（murmur->代理）
	// 写侧（代理->浏览器 WebRTC）：
	wrLast   time.Time // 上一次 WriteVoice 调用时间
	write    gapStats  // 写调用间隔
	wrMaxDur int64     // 单次 WriteVoice 最大耗时（ms）——暴露锁等待/WriteSample 阻塞
}

// onVoicePacket 收到 Mumble 语音包（gumble 读协程调用，禁止阻塞）。
func (s *Session) onVoicePacket(packet []byte) {
	ParseVoicePacket(packet, func(f VoiceFrame) bool {
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		now := time.Now()
		wrDur := int64(-1) // -1 表示 rtc 未就绪、本帧未写
		if rtc != nil {
			wrStart := time.Now()
			if err := rtc.WriteVoice(f.Session, f.Data); err != nil {
				s.logEvent("voice_write_error", "error", err.Error())
			}
			wrDur = time.Since(wrStart).Milliseconds()
		}
		s.talkingMu.Lock()
		s.voiceFrames[f.Session]++
		n := s.voiceFrames[f.Session]
		st := s.downlink[f.Session]
		if st == nil {
			st = &downlinkStats{}
			s.downlink[f.Session] = st
		}
		if !st.last.IsZero() {
			st.arrive.record(now.Sub(st.last).Milliseconds())
		}
		st.last = now
		st.frames++
		if rtc != nil {
			if !st.wrLast.IsZero() {
				st.write.record(now.Sub(st.wrLast).Milliseconds())
			}
			st.wrLast = now
			if wrDur > st.wrMaxDur {
				st.wrMaxDur = wrDur
			}
		}
		s.talkingMu.Unlock()
		// 与上行 mic_rtp_stats 同节奏（每 50 帧一条）：
		// 到达间隔（gap_*）与写调用间隔（wr_gap_*）对比可定位突发发生的环节，
		// wr_dur_max_ms 暴露写侧锁等待/阻塞
		if n%50 == 1 {
			s.logEvent("voice_downlink_stats", "mumble_session", f.Session, "frames", n,
				"bytes", len(f.Data),
				"gap_avg_ms", st.arrive.avg(), "gap_max_ms", st.arrive.maxGap, "bursts_gt100ms", st.arrive.bursts,
				"wr_gap_avg_ms", st.write.avg(), "wr_gap_max_ms", st.write.maxGap, "wr_bursts_gt100ms", st.write.bursts,
				"wr_dur_max_ms", st.wrMaxDur)
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
	s := l.s
	if e.Type == gumble.DisconnectUser {
		// 用户主动退出（前端 disconnect）触发的上游断开：会话本就在清理，不额外动作
		s.logEvent("mumble_disconnect", "reason", "user_initiated")
		return
	}
	reason := e.String
	if reason == "" && e.Err != nil {
		reason = e.Err.Error()
	}
	if reason == "" {
		reason = "与服务器断开连接"
	}
	code := disconnectCode(s, e)
	s.logEvent("mumble_disconnect", "reason", reason, "code", code, "kind", gumble.ClassifyDisconnectError(e.Err))
	s.push(Envelope{Type: DownDisconnect, Reason: reason, Code: code})
	// 被顶/被踢/封禁：以 4001 关闭，前端收到 code 后不再自动重连；
	// 网络类断开仍以 1011 关闭，驱动前端退避重连。
	switch code {
	case "session_takeover", "kicked", "banned":
		s.requestClose(wsCloseSessionEnded)
	default:
		s.requestClose(websocket.CloseInternalServerErr)
	}
	s.cleanup()
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

func (l *mumbleListener) OnUserList(e *gumble.UserListEvent) {}
func (l *mumbleListener) OnACL(e *gumble.ACLEvent)           {}
func (l *mumbleListener) OnBanList(e *gumble.BanListEvent)   {}
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
