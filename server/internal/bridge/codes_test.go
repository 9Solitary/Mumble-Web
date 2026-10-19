package bridge

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"testing"

	"mumbleweb/server/internal/gumble"
)

func TestMumbleRejectCode(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"username in use", &gumble.RejectError{Type: gumble.RejectUsernameInUse}, "username_in_use"},
		{"server password", &gumble.RejectError{Type: gumble.RejectServerPassword}, "server_password"},
		{"server full", &gumble.RejectError{Type: gumble.RejectServerFull}, "server_full"},
		{"tls", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, "tls"},
		{"dns", &net.DNSError{Err: "no such host", Name: "example.invalid"}, "server_unreachable"},
		{"refused", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, "server_unreachable"},
		{"unknown", errors.New("boom"), "reject"},
	}
	for _, tc := range cases {
		if got := mumbleRejectCode(tc.err); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}
