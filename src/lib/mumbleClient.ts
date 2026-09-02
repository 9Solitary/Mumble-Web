import type { Envelope } from "./protocol";

// MumbleClient 封装浏览器侧的全部网络逻辑：
//  - WebSocket：控制信令 + WebRTC 信令
//  - RTCPeerConnection：语音（Opus），每个远端说话人一条 track
export type ClientEventHandler = (env: Envelope) => void;

export class MumbleClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null; // 原始采集轨：始终开启，供电平检测
  private rtcTrack: MediaStreamTrack | null = null; // micTrack 的克隆轨：发给 WebRTC，门控只作用于它
  private micEnabled = false; // 当前门控状态（换输入设备后恢复用）

  // 麦克风电平检测（VAD / 设置页电平条）
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  onMessage: ClientEventHandler = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  onRemoteTrack: (session: number, stream: MediaStream) => void = () => {};
  onRemoteTrackEnded: (session: number) => void = () => {};
  onMicReady: () => void = () => {};
  onMicError: (err: string) => void = () => {};

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => this.onOpen();
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

  private micConstraints(deviceId?: string): MediaStreamConstraints {
    return {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
  }

  private setupAnalyser(stream: MediaStream) {
    try {
      this.audioCtx ??= new AudioContext();
      void this.audioCtx.resume();
      this.micSource?.disconnect();
      this.micSource = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.micSource.connect(this.analyser);
      this.analyserBuf = new Float32Array(this.analyser.fftSize);
    } catch {
      this.analyser = null;
      this.analyserBuf = null;
    }
  }

  // 麦克风实时电平（时域 RMS，约 0~1）
  getMicLevel(): number {
    if (!this.analyser || !this.analyserBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sum = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) {
      sum += this.analyserBuf[i] * this.analyserBuf[i];
    }
    return Math.sqrt(sum / this.analyserBuf.length);
  }

  async startAudio(deviceId?: string): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia(
        this.micConstraints(deviceId),
      );
    } catch (e) {
      this.onMicError(`无法访问麦克风: ${e instanceof Error ? e.message : e}`);
      return;
    }
    this.setupAnalyser(this.micStream);
    this.micTrack = this.micStream.getAudioTracks()[0] ?? null;
    // 门控打在克隆轨上：原始轨保持开启，否则被禁用的 track 输出静音，
    // 电平分析器恒为 0，VAD 阈值模式会死锁（门不开→没电平→门更不开）。
    this.rtcTrack = this.micTrack?.clone() ?? null;
    if (this.rtcTrack) this.rtcTrack.enabled = this.micEnabled; // 默认闭麦

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
      // track/stream id 形如 "mumble-<session>"；部分浏览器会重写 track.id，
      // 因此优先取 track.id，取不到再退化到 stream id
      const ids = [ev.track.id, ...(ev.streams ?? []).map((s) => s.id)];
      let session = -1;
      for (const id of ids) {
        const m = /^mumble-(\d+)$/.exec(id);
        if (m) {
          session = parseInt(m[1], 10);
          break;
        }
      }
      console.log("[rtc] 收到远端 track:", ids.join("/"), "-> session", session);
      if (session < 0) return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.onRemoteTrack(session, stream);
      ev.track.onended = () => this.onRemoteTrackEnded(session);
    };

    pc.onconnectionstatechange = () => {
      console.log("[rtc] state:", pc.connectionState);
    };

    if (this.rtcTrack) pc.addTrack(this.rtcTrack, this.micStream!);

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
        console.log("[rtc] 收到代理 answer");
        await pc.setRemoteDescription({ type: "answer", sdp: env.sdp });
      } else if (env.type === "rtcOffer" && env.sdp) {
        // 代理发起的重协商（新说话人加入）
        console.log("[rtc] 收到代理重协商 offer");
        await pc.setRemoteDescription({ type: "offer", sdp: env.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ type: "rtcAnswer", sdp: answer.sdp! });
        console.log("[rtc] 已回送 answer");
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
    this.micEnabled = enabled;
    if (this.rtcTrack) this.rtcTrack.enabled = enabled;
  }

  // 切换音频输入设备：重新采集并用 replaceTrack 热替换（无需重协商）
  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.pc) return; // 未建连时忽略，下次 startAudio 会带上新设置
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(
        this.micConstraints(deviceId || undefined),
      );
    } catch (e) {
      this.onMicError(
        `切换输入设备失败: ${e instanceof Error ? e.message : e}`,
      );
      return;
    }
    const track = stream.getAudioTracks()[0] ?? null;
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const rtcTrack = track.clone();
    rtcTrack.enabled = this.micEnabled;
    try {
      const sender = this.pc
        .getSenders()
        .find((s) => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(rtcTrack);
    } catch (e) {
      console.warn("[rtc] replaceTrack 失败:", e);
    }
    this.rtcTrack?.stop();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = stream;
    this.micTrack = track;
    this.rtcTrack = rtcTrack;
    this.setupAnalyser(stream);
    this.onMicReady();
  }

  get hasMic(): boolean {
    return this.rtcTrack != null;
  }

  dispose() {
    this.send({ type: "disconnect" });
    this.pc?.close();
    this.rtcTrack?.stop();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.ws?.close();
    this.micSource?.disconnect();
    this.micSource = null;
    this.analyser = null;
    this.analyserBuf = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.pc = null;
    this.micStream = null;
    this.micTrack = null;
    this.rtcTrack = null;
    this.ws = null;
  }
}
