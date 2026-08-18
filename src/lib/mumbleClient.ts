import type { Envelope } from "./protocol";

// MumbleClient 封装浏览器侧的全部网络逻辑：
//  - WebSocket：控制信令 + WebRTC 信令
//  - RTCPeerConnection：语音（Opus），每个远端说话人一条 track
export type ClientEventHandler = (env: Envelope) => void;

export class MumbleClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;

  onMessage: ClientEventHandler = () => {};
  onClose: () => void = () => {};
  onRemoteTrack: (session: number, stream: MediaStream) => void = () => {};
  onRemoteTrackEnded: (session: number) => void = () => {};
  onMicReady: () => void = () => {};
  onMicError: (err: string) => void = () => {};

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data));
      } catch {
        /* 忽略坏包 */
      }
    };
    ws.onclose = () => this.onClose();
    this.ws = ws;
  }

  send(env: Envelope) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(env));
    }
  }

  // ---- 语音（WebRTC） ----

  async startAudio(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      this.onMicError(`无法访问麦克风: ${e instanceof Error ? e.message : e}`);
      return;
    }
    this.micTrack = this.micStream.getAudioTracks()[0] ?? null;
    if (this.micTrack) this.micTrack.enabled = false; // 默认闭麦，PTT 时开启

    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.send({
          type: "rtcCandidate",
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid ?? "",
        });
      }
    };

    pc.ontrack = (ev) => {
      // track.id 形如 "mumble-<session>"
      const m = /^mumble-(\d+)$/.exec(ev.track.id);
      const session = m ? parseInt(m[1], 10) : -1;
      if (session < 0) return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.onRemoteTrack(session, stream);
      ev.track.onended = () => this.onRemoteTrackEnded(session);
    };

    pc.onconnectionstatechange = () => {
      console.log("[rtc] state:", pc.connectionState);
    };

    if (this.micTrack) pc.addTrack(this.micTrack, this.micStream!);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "rtcOffer", sdp: offer.sdp! });
    this.onMicReady();
  }

  async handleSignaling(env: Envelope) {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (env.type === "rtcAnswer" && env.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: env.sdp });
      } else if (env.type === "rtcOffer" && env.sdp) {
        // 代理发起的重协商（新说话人加入）
        await pc.setRemoteDescription({ type: "offer", sdp: env.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: "rtcAnswer", sdp: answer.sdp! });
      } else if (env.type === "rtcCandidate" && env.candidate) {
        await pc.addIceCandidate({
          candidate: env.candidate,
          sdpMid: env.sdpMid ?? undefined,
        });
      }
    } catch (e) {
      console.warn("[rtc] signaling error:", e);
    }
  }

  setMicEnabled(enabled: boolean) {
    if (this.micTrack) this.micTrack.enabled = enabled;
  }

  get hasMic(): boolean {
    return this.micTrack != null;
  }

  dispose() {
    this.send({ type: "disconnect" });
    this.pc?.close();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.ws?.close();
    this.pc = null;
    this.micStream = null;
    this.micTrack = null;
    this.ws = null;
  }
}
