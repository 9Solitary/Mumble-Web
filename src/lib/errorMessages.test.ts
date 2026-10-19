import { describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_CODES,
  clientErrorKey,
  imageErrorKey,
  knownErrorKey,
  micErrorKey,
  sessionCopy,
} from "./errorMessages";

describe("服务端错误 code 映射", () => {
  it("常见 reject code 映射到本地化 key", () => {
    expect(knownErrorKey("username_in_use")).toBe("errors.usernameInUse");
    expect(knownErrorKey("server_password")).toBe("errors.serverPassword");
    expect(knownErrorKey("server_unreachable")).toBe("errors.serverUnreachable");
    expect(knownErrorKey("no_certificate")).toBe("errors.tls");
  });

  it("未知 code 返回 null，交给通用文案 + 原始详情", () => {
    expect(knownErrorKey("mystery_code")).toBeNull();
    expect(knownErrorKey("")).toBeNull();
    expect(knownErrorKey(undefined)).toBeNull();
  });

  it("会话终止 code 映射到标题/正文", () => {
    expect(sessionCopy("banned").title).toBe("session.bannedTitle");
    expect(sessionCopy("unknown_code").title).toBe("session.takeoverTitle");
  });
});

describe("客户端错误展示层映射", () => {
  it("代理断开 / 重连失败 / 缺少凭据都映射到本地化摘要", () => {
    expect(clientErrorKey(CLIENT_ERROR_CODES.proxyDisconnected)).toBe(
      "errors.proxyDisconnected",
    );
    expect(clientErrorKey(CLIENT_ERROR_CODES.reconnectFailed)).toBe(
      "errors.reconnectFailed",
    );
    expect(clientErrorKey(CLIENT_ERROR_CODES.proxyUnreachable)).toBe(
      "errors.proxyUnreachable",
    );
    expect(clientErrorKey(CLIENT_ERROR_CODES.missingCredentials)).toBe(
      "errors.missingCredentials",
    );
    expect(clientErrorKey(CLIENT_ERROR_CODES.loginRejected)).toBe(
      "errors.loginRejected",
    );
    expect(clientErrorKey(CLIENT_ERROR_CODES.disconnected)).toBe(
      "errors.disconnected",
    );
  });

  it("未知客户端错误返回 null", () => {
    expect(clientErrorKey("something else")).toBeNull();
    expect(clientErrorKey("")).toBeNull();
  });
});

describe("麦克风与图片错误映射", () => {
  it("麦克风错误按稳定前缀映射", () => {
    expect(micErrorKey("mic_access: NotAllowedError")).toBe(
      "errors.micAccess",
    );
    expect(micErrorKey("mic_switch: NotFoundError")).toBe(
      "errors.micSwitch",
    );
    expect(micErrorKey("other error")).toBeNull();
  });

  it("图片错误按稳定标识映射", () => {
    expect(imageErrorKey("image_read_failed")).toBe("chat.imageReadFailed");
    expect(imageErrorKey("image_decode_failed")).toBe("chat.imageDecodeFailed");
    expect(imageErrorKey("image_too_large")).toBe("chat.imageTooLarge");
    expect(imageErrorKey("other error")).toBeNull();
  });
});
