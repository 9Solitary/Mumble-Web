import { describe, expect, it } from "vitest";
import type { Envelope } from "./protocol";

// protocol.ts 是纯类型定义，测试围绕信封的构造与解析（JSON round-trip）
describe("protocol 信封", () => {
  it("hello 信封解析出 sid / version / server", () => {
    const raw = JSON.stringify({
      type: "hello",
      sid: "0123456789abcdef",
      version: "dev",
      server: {
        address: "example.com:64738",
        resolved: "1.2.3.4:64738",
        tlsMode: "verify",
        voice: "webrtc",
      },
    });
    const env = JSON.parse(raw) as Envelope;
    expect(env.type).toBe("hello");
    expect(env.sid).toBe("0123456789abcdef");
    expect(env.version).toBe("dev");
    expect(env.server?.address).toBe("example.com:64738");
  });

  it("connect 信封构造（普通模式）", () => {
    const env: Envelope = {
      type: "connect",
      username: "alice",
      password: "pw",
      clientId: "tab-1",
      serverAddr: "example.com:64738",
    };
    const round = JSON.parse(JSON.stringify(env)) as Envelope;
    expect(round.type).toBe("connect");
    expect(round.username).toBe("alice");
    expect(round.clientId).toBe("tab-1");
    expect(round.serverAddr).toBe("example.com:64738");
  });

  it("connect 信封构造（邀请模式带 inviteToken）", () => {
    const env: Envelope = { type: "connect", username: "bob", inviteToken: "tok" };
    const round = JSON.parse(JSON.stringify(env)) as Envelope;
    expect(round.inviteToken).toBe("tok");
    expect(round.password).toBeUndefined();
  });

  it("rtcOffer 信封携带 sdp 字段", () => {
    const env: Envelope = { type: "rtcOffer", sdp: "v=0 ..." };
    const round = JSON.parse(JSON.stringify(env)) as Envelope;
    expect(round.type).toBe("rtcOffer");
    expect(round.sdp).toContain("v=0");
  });
});
