package bridge

import (
	"mumbleweb/server/internal/gumble/varint"
)

// Mumble 语音包（UDPTunnel 载荷）格式：
//
//	byte0      : (codecType << 5) | target
//	varint     : session（仅下行/入站包含发送者 session）
//	varint     : sequence
//	loop       : varint(len | 0x2000*终结位) + opus 数据
//	[可选]     : 12 字节位置信息（3 个 float32）
//
// 代理不解码 Opus，只在 WebRTC RTP 负载与 Mumble 语音帧之间做透传。

const (
	voiceCodecOpus      = 4
	voiceTerminatorFlag = 0x2000
)

// VoiceFrame 是解析出的一帧 Opus 语音。
type VoiceFrame struct {
	Session  uint32
	Target   byte
	Sequence int64
	Data     []byte // Opus 负载
	Final    bool   // 一段发言的最后一帧
}

// ParseVoicePacket 解析入站语音包（含发送者 session）。
// 一个包内可能含多帧，逐帧回调；onFrame 返回 false 可中止。
func ParseVoicePacket(packet []byte, onFrame func(f VoiceFrame) bool) bool {
	if len(packet) < 1 {
		return false
	}
	codec := (packet[0] >> 5) & 0x7
	if codec != voiceCodecOpus {
		return false
	}
	target := packet[0] & 0x1F
	rest := packet[1:]

	session, n := varint.Decode(rest)
	if n <= 0 {
		return false
	}
	rest = rest[n:]

	seq, n := varint.Decode(rest)
	if n <= 0 {
		return false
	}
	rest = rest[n:]

	for len(rest) > 0 {
		hdr, n := varint.Decode(rest)
		if n <= 0 {
			return false
		}
		rest = rest[n:]
		length := int(hdr) &^ voiceTerminatorFlag
		final := int(hdr)&voiceTerminatorFlag != 0
		if length == 0 {
			if final {
				break
			}
			continue
		}
		if length > len(rest) {
			return false
		}
		frame := VoiceFrame{
			Session:  uint32(session),
			Target:   target,
			Sequence: seq,
			Data:     rest[:length],
			Final:    final,
		}
		if !onFrame(frame) {
			return true
		}
		rest = rest[length:]
		// 单帧包后面可能跟 12 字节位置信息，长度不足时直接结束
		if len(rest) == 12 {
			break
		}
	}
	return true
}

// BuildVoicePacket 构造出站语音包（不含 session，目标为当前频道）。
// 每个包只含一帧，final=true 表示带终结位（每帧独立成段，原生客户端可正确处理）。
func BuildVoicePacket(sequence int64, opus []byte) []byte {
	buf := make([]byte, 0, 1+varint.MaxVarintLen*2+len(opus))
	buf = append(buf, byte(voiceCodecOpus<<5)) // target = 0（正常对频道说话）
	tmp := make([]byte, varint.MaxVarintLen)
	n := varint.Encode(tmp, sequence)
	buf = append(buf, tmp[:n]...)
	n = varint.Encode(tmp, int64(len(opus))|voiceTerminatorFlag)
	buf = append(buf, tmp[:n]...)
	buf = append(buf, opus...)
	return buf
}
