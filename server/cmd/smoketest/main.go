// 联调冒烟测试：连接真实 Mumble 服务器，打印频道树与在线用户后退出。
// 用法: go run ./cmd/smoketest -server voice.azsyc.com -tls insecure [-user testuser]
package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"mumbleweb/server/internal/gumble"
	"mumbleweb/server/internal/mumbleconn"
)

type listener struct {
	done chan struct{}
}

func (l *listener) OnConnect(e *gumble.ConnectEvent) {
	fmt.Println("=== 连接成功 ===")
	if e.WelcomeMessage != nil {
		fmt.Printf("欢迎消息: %s\n", *e.WelcomeMessage)
	}
	fmt.Printf("我的会话: session=%d name=%s\n", e.Client.Self.Session, e.Client.Self.Name)
	fmt.Println("--- 频道树 ---")
	var walk func(ch *gumble.Channel, depth int)
	walk = func(ch *gumble.Channel, depth int) {
		users := ""
		for _, u := range ch.Users {
			users += fmt.Sprintf(" [%s#%d]", u.Name, u.Session)
		}
		fmt.Printf("%*s- #%d %s%s\n", depth*2, "", ch.ID, ch.Name, users)
		for _, sub := range ch.Children {
			walk(sub, depth+1)
		}
	}
	if root := e.Client.Channels[0]; root != nil {
		walk(root, 0)
	}
	fmt.Printf("--- 在线用户 (%d) ---\n", len(e.Client.Users))
	for _, u := range e.Client.Users {
		chName := ""
		if u.Channel != nil {
			chName = u.Channel.Name
		}
		fmt.Printf("  %s (session=%d, channel=%s)\n", u.Name, u.Session, chName)
	}
	close(l.done)
}

func (l *listener) OnDisconnect(e *gumble.DisconnectEvent) { fmt.Println("断开:", e.String); close(l.done) }
func (l *listener) OnTextMessage(e *gumble.TextMessageEvent) {}
func (l *listener) OnUserChange(e *gumble.UserChangeEvent)   {}
func (l *listener) OnChannelChange(e *gumble.ChannelChangeEvent) {}
func (l *listener) OnPermissionDenied(e *gumble.PermissionDeniedEvent) {}
func (l *listener) OnUserList(e *gumble.UserListEvent)       {}
func (l *listener) OnACL(e *gumble.ACLEvent)                 {}
func (l *listener) OnBanList(e *gumble.BanListEvent)         {}
func (l *listener) OnContextActionChange(e *gumble.ContextActionChangeEvent) {}
func (l *listener) OnServerConfig(e *gumble.ServerConfigEvent) {}

func main() {
	server := flag.String("server", "voice.azsyc.com", "Mumble 服务器")
	tlsMode := flag.String("tls", "insecure", "TLS 策略")
	user := flag.String("user", "web-smoketest", "用户名")
	flag.Parse()

	target, err := mumbleconn.Resolve(*server, *tlsMode)
	if err != nil {
		log.Fatalf("resolve: %v", err)
	}
	fmt.Printf("解析: %s -> %s (SNI=%s, TLS=%s)\n", target.Original, target.Address, target.SNI, target.TLSMode)

	config := gumble.NewConfig()
	config.Username = *user
	l := &listener{done: make(chan struct{})}
	config.Attach(l)

	start := time.Now()
	client, err := mumbleconn.Dial(target, config)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	fmt.Printf("TCP+TLS 握手成功 (%s)\n", time.Since(start).Round(time.Millisecond))

	select {
	case <-l.done:
	case <-time.After(30 * time.Second):
		fmt.Println("超时")
	}
	client.Disconnect()
}
