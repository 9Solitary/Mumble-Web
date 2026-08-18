// Package bridge 实现「浏览器 ⇄ Mumble 服务器」的桥接层。
// 本文件定义浏览器与代理之间的 WebSocket JSON 消息协议。
package bridge

// ---- 下行消息（proxy -> browser） ----

const (
	DownHello       = "hello"        // 连接建立
	DownServerInfo  = "serverInfo"   // 上游服务器解析信息
	DownConnected   = "connected"    // Mumble 登录成功
	DownSynced      = "synced"       // 频道/用户状态同步完成
	DownReject      = "reject"       // 登录被拒绝
	DownDisconnect  = "disconnected" // 与 Mumble 断开
	DownChannel     = "channel"      // 频道新增/变更
	DownChannelDel  = "channelRemove"
	DownUser        = "user" // 用户新增/变更
	DownUserDel     = "userRemove"
	DownText        = "textMessage"
	DownTalking     = "talking" // 说话状态
	DownDenied      = "permissionDenied"
	DownRtcOffer    = "rtcOffer" // WebRTC 信令
	DownRtcIce      = "rtcCandidate"
	DownError       = "error"
)

// ---- 上行消息（browser -> proxy） ----

const (
	UpConnect     = "connect" // {username, password}
	UpJoinChannel = "joinChannel"
	UpSendText    = "sendText"
	UpSelfMute    = "setSelfMute"
	UpSelfDeaf    = "setSelfDeaf"
	UpPtt         = "ptt" // {active: bool} 转发麦克风开关
	UpRtcAnswer   = "rtcAnswer"
	UpRtcIce      = "rtcCandidate"
	UpDisconnect  = "disconnect"
)

// Envelope 是所有 WS 消息的统一封装。
type Envelope struct {
	Type string `json:"type"`
	// 以下字段按 type 可选填充，保持协议扁平、前端好处理。
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
	Session   uint32 `json:"session,omitempty"`
	ChannelID uint32 `json:"channelId,omitempty"`
	Message   string `json:"message,omitempty"`
	Active    *bool  `json:"active,omitempty"`
	Mute      *bool  `json:"mute,omitempty"`
	Deaf      *bool  `json:"deaf,omitempty"`
	Reason    string `json:"reason,omitempty"`

	// WebRTC 信令
	SDP       string `json:"sdp,omitempty"`
	Candidate string `json:"candidate,omitempty"`
	SDPMid    string `json:"sdpMid,omitempty"`

	// 下行载荷
	Server   *ServerInfoPayload   `json:"server,omitempty"`
	Self     *SelfPayload         `json:"self,omitempty"`
	Channel  *ChannelPayload      `json:"channel,omitempty"`
	User     *UserPayload         `json:"user,omitempty"`
	Text     *TextPayload         `json:"text,omitempty"`
	Talking  *TalkingPayload      `json:"talking,omitempty"`
}

type ServerInfoPayload struct {
	Address  string `json:"address"`  // 原始配置（可能是 SRV 名）
	Resolved string `json:"resolved"` // 实际连接的 host:port
	TLSMode  string `json:"tlsMode"`
	Voice    string `json:"voice"` // 语音通道模式，当前固定 "tcp-tunnel"
}

type SelfPayload struct {
	Session        uint32 `json:"session"`
	Name           string `json:"name"`
	ChannelID      uint32 `json:"channelId"`
	WelcomeMessage string `json:"welcomeMessage,omitempty"`
	MaxMsgLength   int    `json:"maxMessageLength,omitempty"`
}

type ChannelPayload struct {
	ID          uint32 `json:"id"`
	ParentID    int64  `json:"parentId"` // -1 表示根
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Position    int32  `json:"position"`
	Temporary   bool   `json:"temporary"`
}

type UserPayload struct {
	Session         uint32 `json:"session"`
	Name            string `json:"name"`
	ChannelID       uint32 `json:"channelId"`
	Muted           bool   `json:"muted"`
	Deafened        bool   `json:"deafened"`
	Suppressed      bool   `json:"suppressed"`
	SelfMuted       bool   `json:"selfMuted"`
	SelfDeafened    bool   `json:"selfDeafened"`
	PrioritySpeaker bool   `json:"prioritySpeaker"`
	Registered      bool   `json:"registered"`
	Comment         string `json:"comment,omitempty"`
}

type TextPayload struct {
	Sender     uint32   `json:"sender"` // 0 表示服务器消息
	SenderName string   `json:"senderName"`
	ChannelIDs []uint32 `json:"channelIds"`
	Message    string   `json:"message"`
	Time       int64    `json:"time"`
}

type TalkingPayload struct {
	Session uint32 `json:"session"`
	Talking bool   `json:"talking"`
}
