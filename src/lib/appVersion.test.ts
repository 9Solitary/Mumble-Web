import { describe, expect, it } from "vitest";

import { APP_VERSION } from "./appVersion";

describe("APP_VERSION", () => {
  it("始终提供非空版本号", () => {
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
