package gumble

import (
	"crypto/tls"
	"errors"
	"io"
	"log/slog"
	"math"
	"net"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/golang/protobuf/proto"
	"mumbleweb/server/internal/gumble/MumbleProto"
	"mumbleweb/server/internal/gumble/varint"
)

// State is the current state of the client's connection to the server.
type State int

const (
	// StateDisconnected means the client is no longer connected to the server.
	StateDisconnected State = iota

	// StateConnected means the client is connected to the server and is
	// syncing initial information. This is an internal state that will
	// never be returned by Client.State().
	StateConnected

	// StateSynced means the client is connected to a server and has been sent
	// the server state.
	StateSynced
)

// ClientVersion is the protocol version that Client implements.
const ClientVersion = 1<<16 | 3<<8 | 0

// Client is the type used to create a connection to a server.
type Client struct {
	// The User associated with the client.
	Self *User
	// The client's configuration.
	Config *Config
	// The underlying Conn to the server.
	Conn *Conn

	// The users currently connected to the server.
	Users Users
	// The connected server's channels.
	Channels    Channels
	permissions map[uint32]*Permission
	tmpACL      *ACL

	// Ping stats
	tcpPacketsReceived uint32
	tcpPingTimes       [12]float32
	tcpPingAvg         uint32
	tcpPingVar         uint32
	tcpPingLast        uint32 // 最近一次 Ping RTT（float32 bits，毫秒）

	// 读侧语音到达间隔统计（session -> 统计），仅读协程访问，无锁
	voiceReadStats map[uint32]*voiceGapStats

	// A collection containing the server's context actions.
	ContextActions ContextActions

	// The audio encoder used when sending audio to the server.
	AudioEncoder AudioEncoder
	audioCodec   AudioCodec
	// RawVoiceHandler, if non-nil, receives every incoming voice packet
	// (UDPTunnel payload) verbatim, bypassing audio decoding.
	// Added for mumble-web Opus passthrough. Must not block.
	RawVoiceHandler func(packet []byte)
	// To whom transmitted audio will be sent. The VoiceTarget must have already
	// been sent to the server for targeting to work correctly. Setting to nil
	// will disable voice targeting (i.e. switch back to regular speaking).
	VoiceTarget *VoiceTarget

	state uint32

	// volatile is held by the client when the internal data structures are being
	// modified.
	volatile rpwMutex

	connect         chan *RejectError
	end             chan struct{}
	disconnectEvent DisconnectEvent
}

// Dial is an alias of DialWithDialer(new(net.Dialer), addr, config, nil).
func Dial(addr string, config *Config) (*Client, error) {
	return DialWithDialer(new(net.Dialer), addr, config, nil)
}

// DialWithDialer connects to the Mumble server at the given address.
//
// The function returns after the connection has been established, the initial
// server information has been synced, and the OnConnect handlers have been
// called.
//
// nil and an error is returned if server synchronization does not complete by
// min(time.Now() + dialer.Timeout, dialer.Deadline), or if the server rejects
// the client.
func DialWithDialer(dialer *net.Dialer, addr string, config *Config, tlsConfig *tls.Config) (*Client, error) {
	start := time.Now()

	conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	if err != nil {
		return nil, err
	}

	client := &Client{
		Conn:     NewConn(conn),
		Config:   config,
		Users:    make(Users),
		Channels: make(Channels),

		permissions: make(map[uint32]*Permission),

		voiceReadStats: make(map[uint32]*voiceGapStats),

		state: uint32(StateConnected),

		connect: make(chan *RejectError),
		end:     make(chan struct{}),
	}

	go client.readRoutine()

	// Initial packets
	versionPacket := MumbleProto.Version{
		Version:   proto.Uint32(ClientVersion),
		Release:   proto.String("gumble"),
		Os:        proto.String(runtime.GOOS),
		OsVersion: proto.String(runtime.GOARCH),
	}
	authenticationPacket := MumbleProto.Authenticate{
		Username: &client.Config.Username,
		Password: &client.Config.Password,
		// mumble-web patch: we always speak Opus (passthrough from WebRTC).
		Opus:     proto.Bool(true),
		Tokens:   client.Config.Tokens,
	}
	client.Conn.WriteProto(&versionPacket)
	client.Conn.WriteProto(&authenticationPacket)

	go client.pingRoutine()

	var timeout <-chan time.Time
	{
		var deadline time.Time
		if !dialer.Deadline.IsZero() {
			deadline = dialer.Deadline
		}
		if dialer.Timeout > 0 {
			diff := start.Add(dialer.Timeout)
			if deadline.IsZero() || diff.Before(deadline) {
				deadline = diff
			}
		}
		if !deadline.IsZero() {
			timer := time.NewTimer(deadline.Sub(start))
			defer timer.Stop()
			timeout = timer.C
		}
	}

	select {
	case <-timeout:
		client.Conn.Close()
		return nil, errors.New("gumble: synchronization timeout")
	case err := <-client.connect:
		if err != nil {
			client.Conn.Close()
			return nil, err
		}

		return client, nil
	}
}

// State returns the current state of the client.
func (c *Client) State() State {
	return State(atomic.LoadUint32(&c.state))
}

// AudioOutgoing creates a new channel that outgoing audio data can be written
// to. The channel must be closed after the audio stream is completed. Only
// a single channel should be open at any given time (i.e. close the channel
// before opening another).
func (c *Client) AudioOutgoing() chan<- AudioBuffer {
	ch := make(chan AudioBuffer)
	go func() {
		var seq int64
		previous := <-ch
		for p := range ch {
			previous.writeAudio(c, seq, false)
			previous = p
			seq = (seq + 1) % math.MaxInt32
		}
		if previous != nil {
			previous.writeAudio(c, seq, true)
		}
	}()
	return ch
}

// pingRoutine sends ping packets to the server at regular intervals.
func (c *Client) pingRoutine() {
	ticker := time.NewTicker(time.Second * 5)
	defer ticker.Stop()

	var timestamp uint64
	var tcpPingAvg float32
	var tcpPingVar float32
	packet := MumbleProto.Ping{
		Timestamp:  &timestamp,
		TcpPackets: &c.tcpPacketsReceived,
		TcpPingAvg: &tcpPingAvg,
		TcpPingVar: &tcpPingVar,
	}

	t := time.Now()
	tick := 0
	for {
		timestamp = uint64(t.UnixNano())
		tcpPingAvg = math.Float32frombits(atomic.LoadUint32(&c.tcpPingAvg))
		tcpPingVar = math.Float32frombits(atomic.LoadUint32(&c.tcpPingVar))
		c.Conn.WriteProto(&packet)

		select {
		case <-c.end:
			return
		case t = <-ticker.C:
			tick++
			// mumble-web patch: 每 30s 输出一次 Ping RTT。
			// 语音与 Ping 共用同一条 TCP：语音突发期间 RTT 同步飙升是网络层问题的强证据。
			// gumble 层拿不到 sid，用 username 关联（bridge 侧 mumble_connect 日志含 sid+username）。
			if tick%6 == 0 {
				slog.Info("mumble_ping_rtt", "event", "mumble_ping_rtt", "username", c.Config.Username,
					"rtt_ms", math.Float32frombits(atomic.LoadUint32(&c.tcpPingLast)),
					"rtt_avg_ms", tcpPingAvg, "rtt_var_ms", tcpPingVar)
			}
		}
	}
}

// readRoutine reads protocol buffer messages from the server.
func (c *Client) readRoutine() {
	c.disconnectEvent = DisconnectEvent{
		Client: c,
		Type:   DisconnectError,
	}

	// 读循环退出的真实错误，透出给 OnDisconnect（此前被吞掉，断线原因无从排查）
	var readErr error
	for {
		pType, data, err := c.Conn.ReadPacket()
		if err != nil {
			readErr = err
			break
		}
		// mumble-web patch: UDPTunnel 语音包在 ReadPacket 返回处就地打点，
		// 与 bridge 层 onVoicePacket 的统计对比可定位突发成串到达发生在哪一段
		if pType == messageTypeUDPTunnel {
			c.noteVoiceRead(data, time.Now())
		}
		if int(pType) < len(handlers) {
			handlers[pType](c, data)
		}
	}

	wasSynced := c.State() == StateSynced
	atomic.StoreUint32(&c.state, uint32(StateDisconnected))
	close(c.end)
	// 用户主动 Disconnect() 导致的读失败不算异常，Err 留空
	if c.disconnectEvent.Type != DisconnectUser {
		c.disconnectEvent.Err = readErr
	}
	if wasSynced {
		c.Config.Listeners.onDisconnect(&c.disconnectEvent)
	}
}

// 读侧语音观测阈值，与 bridge 层 downlinkStats 同口径：
// 正常帧间隔约 10~20ms；>100ms 计一次突发，>500ms 视为说话间隙不计入统计。
const (
	voiceReadBurstGapMs   = 100
	voiceReadSilenceGapMs = 500
)

// messageTypeUDPTunnel 是 UDPTunnel 消息在 handlers 表中的下标。
const messageTypeUDPTunnel = 1

// voiceGapStats 是单路说话人的读侧到达间隔统计（仅读协程访问，无锁）。
type voiceGapStats struct {
	last   time.Time
	frames int
	sumGap int64
	gapN   int
	maxGap int64
	bursts int
}

func (g *voiceGapStats) record(now time.Time) {
	if !g.last.IsZero() {
		if gap := now.Sub(g.last).Milliseconds(); gap <= voiceReadSilenceGapMs {
			g.sumGap += gap
			g.gapN++
			if gap > g.maxGap {
				g.maxGap = gap
			}
			if gap > voiceReadBurstGapMs {
				g.bursts++
			}
		}
	}
	g.last = now
	g.frames++
}

// noteVoiceRead 在读协程记录 UDPTunnel 语音包到达时间，按说话人统计到达间隔。
// 判读：读侧平滑而 bridge 侧有突发 = 代理内部停顿（读协程被同步写阻塞）；
// 两侧一致突发 = 数据到达内核时就已成批（网络/TCP 或 murmur 调度），代理无责。
func (c *Client) noteVoiceRead(packet []byte, now time.Time) {
	// 只看 Opus 语音帧：byte0 = (codec << 5) | target
	if len(packet) < 2 || (packet[0]>>5)&0x7 != audioCodecIDOpus {
		return
	}
	session, n := varint.Decode(packet[1:])
	if n <= 0 {
		return
	}
	st := c.voiceReadStats[uint32(session)]
	if st == nil {
		st = &voiceGapStats{}
		c.voiceReadStats[uint32(session)] = st
	}
	st.record(now)
	if st.frames%50 == 1 {
		var gapAvg int64
		if st.gapN > 0 {
			gapAvg = st.sumGap / int64(st.gapN)
		}
		slog.Info("mumble_read_stats", "event", "mumble_read_stats", "username", c.Config.Username,
			"mumble_session", session, "frames", st.frames,
			"rd_gap_avg_ms", gapAvg, "rd_gap_max_ms", st.maxGap, "rd_bursts_gt100ms", st.bursts)
	}
}

// ClassifyDisconnectError 把读循环的底层错误归类，用于日志与诊断：
// timeout（读超时）/ closed（对端关闭或 EOF）/ tls（TLS 层错误）/ other / none。
func ClassifyDisconnectError(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed):
		return "closed"
	case isTimeoutError(err):
		return "timeout"
	case isTLSError(err):
		return "tls"
	default:
		return "other"
	}
}

func isTimeoutError(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func isTLSError(err error) bool {
	var recErr tls.RecordHeaderError
	var certErr *tls.CertificateVerificationError
	return errors.As(err, &recErr) || errors.As(err, &certErr)
}

// RequestUserList requests that the server's registered user list be sent to
// the client.
func (c *Client) RequestUserList() {
	packet := MumbleProto.UserList{}
	c.Conn.WriteProto(&packet)
}

// RequestBanList requests that the server's ban list be sent to the client.
func (c *Client) RequestBanList() {
	packet := MumbleProto.BanList{
		Query: proto.Bool(true),
	}
	c.Conn.WriteProto(&packet)
}

// Disconnect disconnects the client from the server.
func (c *Client) Disconnect() error {
	if c.State() == StateDisconnected {
		return errors.New("gumble: client is already disconnected")
	}
	c.disconnectEvent.Type = DisconnectUser
	c.Conn.Close()
	return nil
}

// Do executes f in a thread-safe manner. It ensures that Client and its
// associated data will not be changed during the lifetime of the function
// call.
func (c *Client) Do(f func()) {
	c.volatile.RLock()
	defer c.volatile.RUnlock()

	f()
}

// Send will send a Message to the server.
func (c *Client) Send(message Message) {
	message.writeMessage(c)
}
