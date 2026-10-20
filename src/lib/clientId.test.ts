import { beforeEach, describe, expect, it } from "vitest";

import { CLIENT_ID_STORAGE_KEY, getClientId } from "./clientId";

describe("clientId", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("同一标签页稳定，并写入 sessionStorage", () => {
    const first = getClientId();
    expect(first).not.toBe("");
    expect(getClientId()).toBe(first);
    expect(window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY)).toBe(first);
  });

  it("清除 sessionStorage 后生成新的标签页标识", () => {
    const first = getClientId();
    window.sessionStorage.clear();
    expect(getClientId()).not.toBe(first);
  });
});
