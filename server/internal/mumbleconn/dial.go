// Package mumbleconn 负责上游 Mumble 服务器的地址解析与安全拨号。
package mumbleconn

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"net"
	"strings"
	"time"

	"mumbleweb/server/internal/gumble"
)

const dialTimeout = 10 * time.Second

// Target 描述一个待连接的上游 Mumble 服务器。
type Target struct {
	Original string // 用户配置的原始值，如 voice.azsyc.com
	Address  string // 解析后的 host:port，如 tencent.azsyc.com:64738
	SNI      string // TLS ServerName（SRV 场景下与拨号主机不同）
	TLSMode  string // verify | insecure | pin:<sha256 指纹>
}

// Resolve 解析服务器地址：
//   - "host:port"      直接使用
//   - "name"           先查 _mumble._tcp.<name> SRV，失败则回退 name:64738
func Resolve(server, tlsMode string) (Target, error) {
	t := Target{Original: server, TLSMode: tlsMode}

	host, _, err := net.SplitHostPort(server)
	if err == nil {
		t.Address = server
		t.SNI = host
		return t, nil
	}

	// 无端口：尝试 SRV
	_, addrs, err := net.LookupSRV("mumble", "tcp", server)
	if err == nil && len(addrs) > 0 {
		target := strings.TrimSuffix(addrs[0].Target, ".")
		t.Address = fmt.Sprintf("%s:%d", target, addrs[0].Port)
		t.SNI = server // 证书通常签给 SRV 名
		return t, nil
	}

	// SRV 不存在：默认端口 64738
	t.Address = net.JoinHostPort(server, "64738")
	t.SNI = server
	return t, nil
}

// TLSConfig 按策略生成 tls.Config。
//   - verify   ：正常校验（证书有效时使用）
//   - pin:XXXX ：固定证书 SHA256 指纹（证书过期/自签时的推荐做法）
//   - insecure ：跳过所有校验（仅调试）
func (t Target) TLSConfig() (*tls.Config, error) {
	mode := t.TLSMode
	switch {
	case mode == "" || mode == "verify":
		return &tls.Config{ServerName: t.SNI, MinVersion: tls.VersionTLS12}, nil

	case mode == "insecure":
		return &tls.Config{InsecureSkipVerify: true, ServerName: t.SNI}, nil //nolint:gosec

	case strings.HasPrefix(mode, "pin:"):
		want := strings.ToUpper(strings.ReplaceAll(strings.TrimPrefix(mode, "pin:"), ":", ""))
		return &tls.Config{
			InsecureSkipVerify: true, //nolint:gosec // 以指纹比对替代链式校验
			ServerName:         t.SNI,
			VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
				if len(rawCerts) == 0 {
					return fmt.Errorf("服务器未提供证书")
				}
				sum := sha256.Sum256(rawCerts[0])
				got := strings.ToUpper(hex.EncodeToString(sum[:]))
				if got != want {
					return fmt.Errorf("证书指纹不匹配: got %s, want %s", got, want)
				}
				return nil
			},
		}, nil
	}
	return nil, fmt.Errorf("未知 TLS 策略: %s", mode)
}

// Dial 解析并连接 Mumble 服务器。
func Dial(t Target, config *gumble.Config) (*gumble.Client, error) {
	tlsConfig, err := t.TLSConfig()
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: dialTimeout}
	return gumble.DialWithDialer(dialer, t.Address, config, tlsConfig)
}
