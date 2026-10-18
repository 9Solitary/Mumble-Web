package gumble

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
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
