import { describe, it, expect, beforeEach, vi } from "vitest";

describe("checkRate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows up to 100 hits per IP per minute, then 429s", async () => {
    const { checkRate } = await import("./rate-limit");
    for (let i = 0; i < 100; i++) {
      expect(checkRate("1.2.3.4")).toBe(true);
    }
    expect(checkRate("1.2.3.4")).toBe(false);
    expect(checkRate("1.2.3.4")).toBe(false);
  });

  it("isolates buckets per IP", async () => {
    const { checkRate } = await import("./rate-limit");
    for (let i = 0; i < 100; i++) checkRate("5.6.7.8");
    // Different IP should still be allowed
    expect(checkRate("9.10.11.12")).toBe(true);
  });
});
