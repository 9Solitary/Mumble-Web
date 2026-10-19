package bridge

import (
	"crypto/tls"
	"errors"
	"net"
	"strings"

	"mumbleweb/server/internal/gumble"
)

// 稳定错误码：前端只认 code，不再依赖服务端的中文 reason。
// reason 仍保留，作为“详情”展示与日志排障。

func mumbleRejectCode(err error) string {
	var re *gumble.RejectError
	if errors.As(err, &re) {
		switch re.Type {
		case gumble.RejectUsernameInUse:
			return "username_in_use"
		case gumble.RejectServerPassword:
			return "server_password"
		case gumble.RejectUserCredentials:
			return "auth"
		case gumble.RejectServerFull:
			return "server_full"
		case gumble.RejectNoCertificate:
			return "no_certificate"
		case gumble.RejectUserName:
			return "invalid_username"
		case gumble.RejectVersion:
			return "version_mismatch"
		case gumble.RejectAuthenticatorFail:
			return "auth"
		default:
			return "reject"
		}
	}

	// 拨号/TLS 失败：给出可操作的分类，前端再展示本地化摘要 + 原始详情。
	var certErr *tls.CertificateVerificationError
	if errors.As(err, &certErr) {
		return "tls"
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "server_unreachable"
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return "server_unreachable"
	}
	return "reject"
}

func disconnectCode(s *Session, e *gumble.DisconnectEvent) string {
	if s != nil && s.registry != nil && s.registry.TakeoverPending(s.sessionKey, s) {
		return "session_takeover"
	}
	switch e.Type {
	case gumble.DisconnectKicked:
		return "kicked"
	case gumble.DisconnectBanned:
		return "banned"
	case gumble.DisconnectError:
		switch gumble.ClassifyDisconnectError(e.Err) {
		case "timeout":
			return "timeout"
		case "tls":
			return "tls"
		case "closed":
			return "closed"
		}
	}
	return "network"
}

// registryKey 归一化同名判断：服务器地址与昵称都按小写比较（Murmur 昵称大小写不敏感）。
func registryKey(serverAddr, username string) string {
	return strings.ToLower(strings.TrimSpace(serverAddr)) + "\x00" +
		strings.ToLower(strings.TrimSpace(username))
}
