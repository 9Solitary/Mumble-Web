import { expect, type Page } from "@playwright/test";

interface MockDevice {
  deviceId: string;
  kind: string;
  label: string;
  groupId: string;
}

const MOCK_DEVICES: MockDevice[] = [
  { deviceId: "in-1", kind: "audioinput", label: "测试麦克风", groupId: "g1" },
  { deviceId: "out-1", kind: "audiooutput", label: "测试耳机", groupId: "g2" },
];

export async function installMockMedia(page: Page) {
  await page.addInitScript((devices: MockDevice[]) => {
    navigator.mediaDevices.enumerateDevices = async () =>
      devices as unknown as MediaDeviceInfo[];
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      return ctx.createMediaStreamDestination().stream;
    };
  }, MOCK_DEVICES);
}

// 最小代理协议 mock：hello → connect → 频道/用户/config → synced。
// 额外处理 joinChannel / mute / deaf，供移动端抽屉加入频道测试使用。
export async function mockProxy(page: Page) {
  await page.routeWebSocket("**/ws", (ws) => {
    const self = {
      session: 1,
      name: "测试用户",
      channelId: 0,
      muted: false,
      deafened: false,
      suppressed: false,
      selfMuted: false,
      selfDeafened: false,
      prioritySpeaker: false,
      registered: false,
    };

    ws.send(
      JSON.stringify({
        type: "hello",
        sid: "e2e-shell",
        version: "e2e",
        server: {
          address: "mock:64738",
          resolved: "127.0.0.1:64738",
          tlsMode: "insecure",
          voice: "tcp-tunnel",
        },
      }),
    );

    ws.onMessage((raw) => {
      const env = JSON.parse(String(raw));
      switch (env.type) {
        case "connect": {
          self.name = env.username ?? self.name;
          ws.send(
            JSON.stringify({
              type: "connected",
              self: { session: 1, name: self.name, channelId: 0, maxMessageLength: 5000 },
            }),
          );
          for (const channel of [
            { id: 0, parentId: -1, name: "根频道", description: "", position: 0, temporary: false },
            { id: 1, parentId: 0, name: "闲聊", description: "", position: 1, temporary: false },
            { id: 2, parentId: 0, name: "开黑房", description: "", position: 2, temporary: false },
            { id: 3, parentId: 2, name: "公告", description: "", position: 3, temporary: false },
          ]) {
            ws.send(JSON.stringify({ type: "channel", channel }));
          }
          ws.send(
            JSON.stringify({
              type: "user",
              user: {
                session: 2,
                name: "机器人小助手",
                channelId: 1,
                muted: false,
                deafened: false,
                suppressed: false,
                selfMuted: false,
                selfDeafened: false,
                prioritySpeaker: false,
                registered: true,
                comment: "负责提醒和欢迎",
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "user",
              user: {
                session: 3,
                name: "沉默用户",
                channelId: 1,
                muted: false,
                deafened: false,
                suppressed: false,
                selfMuted: true,
                selfDeafened: false,
                prioritySpeaker: false,
                registered: false,
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: "user",
              user: {
                session: 4,
                name: "开黑用户",
                channelId: 2,
                muted: false,
                deafened: false,
                suppressed: false,
                selfMuted: false,
                selfDeafened: false,
                prioritySpeaker: false,
                registered: false,
              },
            }),
          );
          ws.send(JSON.stringify({ type: "user", user: { ...self } }));
          ws.send(
            JSON.stringify({
              type: "config",
              config: { maxMessageLength: 5000, maxImageMessageLength: 131072 },
            }),
          );
          ws.send(JSON.stringify({ type: "synced" }));
          break;
        }
        case "joinChannel":
          self.channelId = env.channelId ?? 0;
          ws.send(JSON.stringify({ type: "user", user: { ...self } }));
          break;
        case "setSelfMute":
          self.selfMuted = !!env.mute;
          ws.send(JSON.stringify({ type: "user", user: { ...self } }));
          break;
        case "setSelfDeaf":
          self.selfDeafened = !!env.deaf;
          if (env.deaf) self.selfMuted = true;
          ws.send(JSON.stringify({ type: "user", user: { ...self } }));
          break;
        case "sendText":
          ws.send(
            JSON.stringify({
              type: "textMessage",
              text: {
                sender: 1,
                senderName: self.name,
                channelIds: [self.channelId],
                message: env.message,
                time: Math.floor(Date.now() / 1000),
              },
            }),
          );
          break;
        default:
          break;
      }
    });
  });
}

export async function enterApp(page: Page, name = "外壳测试", path = "/") {
  await installMockMedia(page);
  await mockProxy(page);
  await page.goto(path);
  await page.getByTestId("connect-username").fill(name);
  await page.getByTestId("connect-submit").click();
  await expect(page.getByTestId("messages")).toBeVisible();
}
