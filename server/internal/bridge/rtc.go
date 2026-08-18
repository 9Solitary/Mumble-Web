package bridge

import (
	"errors"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// rtcPeer 封装一个浏览器会话的 WebRTC 连接：
//   - 下行：远端 Mumble 用户的 Opus 帧 -> 每人一条 RTP track 发给浏览器
//   - 上行：浏览器麦克风的 Opus RTP -> 解包交给 Mumble 语音发送
type rtcPeer struct {
	pc *webrtc.PeerConnection

	send func(Envelope) // 发送信令到浏览器

	mu         sync.Mutex
	tracks     map[uint32]*speakerTrack // session -> 下行 track
	micHandler func(opus []byte)        // 收到浏览器 Opus 帧
	closed     bool
}

type speakerTrack struct {
	track  *webrtc.TrackLocalStaticSample
	sender *webrtc.RTPSender
}

// newRTCPeer 创建 PeerConnection。udpMux 为全局共享的 ICE UDP 复用器。
func newRTCPeer(udpMux ice.UDPMux, publicIP string, send func(Envelope)) (*rtcPeer, error) {
	me := &webrtc.MediaEngine{}
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	se := webrtc.SettingEngine{}
	se.SetLite(true) // 服务器端 ICE-Lite：只做被动应答，浏览器侧做连通性检查
	if udpMux != nil {
		se.SetICEUDPMux(udpMux)
	}
	if publicIP != "" {
		se.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}

	api := webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return nil, err
	}

	p := &rtcPeer{pc: pc, send: send, tracks: make(map[uint32]*speakerTrack)}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		init := c.ToJSON()
		mid := ""
		if init.SDPMid != nil {
			mid = *init.SDPMid
		}
		send(Envelope{Type: DownRtcIce, Candidate: init.Candidate, SDPMid: mid})
	})

	pc.OnNegotiationNeeded(func() {
		// 新增说话人 track 时触发重新协商；由代理统一发起 offer
		offer, err := pc.CreateOffer(nil)
		if err != nil {
			log.Printf("rtc: create offer: %v", err)
			return
		}
		if err := pc.SetLocalDescription(offer); err != nil {
			log.Printf("rtc: set local: %v", err)
			return
		}
		send(Envelope{Type: DownRtcOffer, SDP: offer.SDP})
	})

	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("rtc: browser mic track started: %s", track.ID())
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				if !errors.Is(err, io.EOF) {
					log.Printf("rtc: mic read end: %v", err)
				}
				return
			}
			p.mu.Lock()
			h := p.micHandler
			p.mu.Unlock()
			if h != nil && len(pkt.Payload) > 0 {
				h(pkt.Payload)
			}
		}
	})

	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("rtc: connection state: %s", s)
	})

	return p, nil
}

// HandleOffer 处理浏览器（携带 mic track）的初始 offer，并回送 answer。
func (p *rtcPeer) HandleOffer(sdp string) error {
	if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer, SDP: sdp,
	}); err != nil {
		return fmt.Errorf("set remote offer: %w", err)
	}
	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return err
	}
	if err := p.pc.SetLocalDescription(answer); err != nil {
		return err
	}
	p.send(Envelope{Type: "rtcAnswer", SDP: answer.SDP})
	return nil
}

// HandleAnswer 处理浏览器对重协商 offer 的 answer。
func (p *rtcPeer) HandleAnswer(sdp string) error {
	return p.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer, SDP: sdp,
	})
}

// AddCandidate 添加浏览器侧 ICE candidate。
func (p *rtcPeer) AddCandidate(candidate, mid string) error {
	return p.pc.AddICECandidate(webrtc.ICECandidateInit{
		Candidate: candidate, SDPMid: &mid,
	})
}

// SetMicHandler 设置麦克风 Opus 帧回调（含 PTT/静音门控后才会被调用方处理）。
func (p *rtcPeer) SetMicHandler(h func(opus []byte)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.micHandler = h
}

// WriteVoice 把某个 Mumble 用户的一帧 Opus 语音写入对应下行 track；
// 首次说话时自动创建 track（触发重协商）。
func (p *rtcPeer) WriteVoice(session uint32, opus []byte) error {
	p.mu.Lock()
	st, ok := p.tracks[session]
	if !ok && !p.closed {
		track, err := webrtc.NewTrackLocalStaticSample(
			webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
			fmt.Sprintf("mumble-%d", session), "mumble",
		)
		if err != nil {
			p.mu.Unlock()
			return err
		}
		sender, err := p.pc.AddTrack(track)
		if err != nil {
			p.mu.Unlock()
			return err
		}
		st = &speakerTrack{track: track, sender: sender}
		p.tracks[session] = st
		log.Printf("rtc: new speaker track for session %d", session)
	}
	p.mu.Unlock()
	if st == nil {
		return nil
	}
	return st.track.WriteSample(media.Sample{
		Data:     opus,
		Duration: opusPacketDuration(opus),
	})
}

// RemoveVoice 移除某用户的下行 track（用户离开频道/服务器时调用）。
func (p *rtcPeer) RemoveVoice(session uint32) {
	p.mu.Lock()
	defer p.mu.Unlock()
	st, ok := p.tracks[session]
	if !ok {
		return
	}
	if err := p.pc.RemoveTrack(st.sender); err != nil {
		log.Printf("rtc: remove track: %v", err)
	}
	delete(p.tracks, session)
}

func (p *rtcPeer) Close() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	p.pc.Close()
}

// opusPacketDuration 解析 Opus 包 TOC，估算样本时长（用于 RTP 时间戳步进）。
func opusPacketDuration(d []byte) time.Duration {
	if len(d) == 0 {
		return 20 * time.Millisecond
	}
	cfg := d[0] >> 3
	var frameMs float64
	switch {
	case cfg < 12:
		frameMs = []float64{10, 20, 40, 60}[cfg%4]
	case cfg < 16:
		frameMs = []float64{10, 20}[cfg%2]
	default:
		frameMs = []float64{2.5, 5, 10, 20}[cfg%4]
	}
	frames := 1
	switch d[0] & 0x3 {
	case 1, 2:
		frames = 2
	case 3:
		if len(d) > 1 {
			frames = int(d[1] & 0x3F)
		}
	}
	return time.Duration(frameMs*float64(frames)*float64(time.Millisecond) + 0.5)
}
