package bridge

import (
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"

	"mumbleweb/server/internal/gumble"
	"mumbleweb/server/internal/mumbleconn"
)

// Session 表示一个浏览器 WebSocket 连接对应的完整会话：
// 一个 gumble.Client（Mumble 登录）+ 一个 WebRTC PeerConnection（语音）。
type Session struct {
	ws   *websocket.Conn
	send chan Envelope
	done chan struct{}

	upstream mumbleconn.Target

	mu        sync.Mutex
	client    *gumble.Client
	rtc       *rtcPeer
	connected bool

	pttActive atomic.Bool
	voiceSeq  int64

	// talking 状态跟踪：session -> 最近一次收到语音帧的时间
	talkingMu sync.Mutex
	lastVoice map[uint32]time.Time
	talking   map[uint32]bool

	rtcUDPPort int
	publicIP   string
	udpMux     ice.UDPMux
}

func NewSession(ws *websocket.Conn, upstream mumbleconn.Target, udpMux ice.UDPMux, publicIP string) *Session {
	return &Session{
		ws:        ws,
		send:      make(chan Envelope, 256),
		done:      make(chan struct{}),
		upstream:  upstream,
		lastVoice: make(map[uint32]time.Time),
		talking:   make(map[uint32]bool),
		udpMux:    udpMux,
		publicIP:  publicIP,
	}
}

// Run 启动写泵与读循环，阻塞直到会话结束。
func (s *Session) Run() {
	defer s.cleanup()

	s.push(Envelope{
		Type: DownHello,
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
		log.Printf("session: send buffer full, dropping %s", env.Type)
	}
}

func (s *Session) writePump() {
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
}

// ---- 上行命令分发 ----

func (s *Session) handle(env Envelope) {
	switch env.Type {
	case UpConnect:
		s.connectMumble(env.Username, env.Password)
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
			s.pttActive.Store(*env.Active)
		}
	case "rtcOffer": // 浏览器初始 offer（携带 mic track）
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.HandleOffer(env.SDP); err != nil {
				log.Printf("rtc offer: %v", err)
			}
		}
	case UpRtcAnswer:
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.HandleAnswer(env.SDP); err != nil {
				log.Printf("rtc answer: %v", err)
			}
		}
	case UpRtcIce:
		s.mu.Lock()
		rtc := s.rtc
		s.mu.Unlock()
		if rtc != nil {
			if err := rtc.AddCandidate(env.Candidate, env.SDPMid); err != nil {
				log.Printf("rtc candidate: %v", err)
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

func (s *Session) connectMumble(username, password string) {
	if username == "" {
		username = "web-guest"
	}

	// 先建 WebRTC 连接（语音桥），再做 Mumble 登录
	rtc, err := newRTCPeer(s.udpMux, s.publicIP, s.push)
	if err != nil {
		s.push(Envelope{Type: DownError, Reason: "WebRTC 初始化失败: " + err.Error()})
		return
	}
	rtc.SetMicHandler(s.onMicFrame)

	config := gumble.NewConfig()
	config.Username = username
	config.Password = password
	listener := &mumbleListener{s: s}
	config.Attach(listener)

	client, err := mumbleconn.Dial(s.upstream, config)
	if err != nil {
		rtc.Close()
		s.push(Envelope{Type: DownReject, Reason: err.Error()})
		return
	}
	client.RawVoiceHandler = s.onVoicePacket

	s.mu.Lock()
	s.client = client
	s.rtc = rtc
	s.connected = true
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
				log.Printf("voice write: %v", err)
			}
		}
		s.markTalking(f.Session)
		return true
	})
}

// onMicFrame 浏览器麦克风 Opus 帧 -> 转发到 Mumble（PTT 门控）。
func (s *Session) onMicFrame(opus []byte) {
	if !s.pttActive.Load() {
		return
	}
	s.mu.Lock()
	c := s.client
	s.mu.Unlock()
	if c == nil {
		return
	}
	seq := atomic.AddInt64(&s.voiceSeq, 1)
	if err := c.Conn.WriteAudio(byte(4), 0, seq, true, opus, nil, nil, nil); err != nil {
		log.Printf("mic forward: %v", err)
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
		return
	}
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
	if e.MaximumMessageLength != nil {
		l.s.push(Envelope{Type: "config", Session: uint32(*e.MaximumMessageLength)})
	}
}
