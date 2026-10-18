package gumble

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang/protobuf/proto"
	"mumbleweb/server/internal/gumble/MumbleProto"
)

// fakeTimeoutError 模拟 net.Error 超时（如 TCP 读死线触发）。
type fakeTimeoutError struct{}

func (fakeTimeoutError) Error() string   { return "read tcp 1.2.3.4:64738: i/o timeout" }
func (fakeTimeoutError) Timeout() bool   { return true }
func (fakeTimeoutError) Temporary() bool { return false }

var _ net.Error = fakeTimeoutError{}

func TestClassifyDisconnectError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil", nil, "none"},
		{"eof", io.EOF, "closed"},
		{"net-closed", net.ErrClosed, "closed"},
		{"timeout", fakeTimeoutError{}, "timeout"},
		{"wrapped-timeout", fmt.Errorf("read packet: %w", fakeTimeoutError{}), "timeout"},
		{"tls-record", tls.RecordHeaderError{Msg: "bad record"}, "tls"},
		{"tls-cert", &tls.CertificateVerificationError{}, "tls"},
		{"other", errors.New("boom"), "other"},
	}
	for _, c := range cases {
		if got := ClassifyDisconnectError(c.err); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// TestVoiceGapStats 验证读侧到达间隔统计：首帧不计、正常/突发计入、静默期不计。
func TestVoiceGapStats(t *testing.T) {
	var st voiceGapStats
	base := time.Now()
	st.record(base)                             // 首帧，无间隔样本
	st.record(base.Add(20 * time.Millisecond))  // 正常 20ms
	st.record(base.Add(170 * time.Millisecond)) // 150ms 突发
	st.record(base.Add(770 * time.Millisecond)) // 600ms 静默，不计入
	if st.frames != 4 {
		t.Fatalf("frames=%d，预期 4", st.frames)
	}
	if st.gapN != 2 || st.sumGap != 170 || st.maxGap != 150 || st.bursts != 1 {
		t.Fatalf("gapN=%d sumGap=%d maxGap=%d bursts=%d，预期 2/170/150/1",
			st.gapN, st.sumGap, st.maxGap, st.bursts)
	}
}

// TestHandlePingRTT 验证 Ping 回包时间戳被解析为 RTT 并记录到 tcpPingLast。
func TestHandlePingRTT(t *testing.T) {
	c := &Client{}
	sent := time.Now().Add(-15 * time.Millisecond)
	packet := MumbleProto.Ping{Timestamp: proto.Uint64(uint64(sent.UnixNano()))}
	data, err := proto.Marshal(&packet)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := c.handlePing(data); err != nil {
		t.Fatalf("handlePing: %v", err)
	}
	rtt := math.Float32frombits(atomic.LoadUint32(&c.tcpPingLast))
	if rtt < 10 || rtt > 5000 {
		t.Fatalf("rtt=%fms，预期接近 15ms", rtt)
	}
}
