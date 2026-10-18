import { afterEach, describe, expect, it } from "vitest";
import { apiUrl, wsUrl } from "./backend";

describe("backend", () => {
  afterEach(() => {
    window.__PROXY_ORIGIN__ = "";
  });

  it("origin 为空时保持同源相对路径", () => {
    window.__PROXY_ORIGIN__ = "";
    expect(apiUrl("/api/server")).toBe("/api/server");
    // jsdom 默认 http://localhost:3000
    expect(wsUrl("/ws")).toBe(`ws://${location.host}/ws`);
  });

  it("origin 非空时 http 映射到 ws、https 映射到 wss", () => {
    window.__PROXY_ORIGIN__ = "http://1.2.3.4:8080";
    expect(apiUrl("/api/diag")).toBe("http://1.2.3.4:8080/api/diag");
    expect(wsUrl("/ws")).toBe("ws://1.2.3.4:8080/ws");

    window.__PROXY_ORIGIN__ = "https://proxy.example.com";
    expect(apiUrl("/api/version")).toBe("https://proxy.example.com/api/version");
    expect(wsUrl("/ws")).toBe("wss://proxy.example.com/ws");
  });

  it("origin 尾部斜杠被剔除", () => {
    window.__PROXY_ORIGIN__ = "https://proxy.example.com/";
    expect(apiUrl("/api/server")).toBe("https://proxy.example.com/api/server");
  });
});
