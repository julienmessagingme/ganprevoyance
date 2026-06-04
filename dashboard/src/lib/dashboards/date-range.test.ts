import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDateRange } from "./date-range";

describe("resolveDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:34:56Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("7d → today − 6 to today", () => {
    expect(resolveDateRange({ preset: "7d" })).toEqual({
      from: "2026-05-09",
      to: "2026-05-15",
    });
  });

  it("30d → today − 29 to today", () => {
    expect(resolveDateRange({ preset: "30d" })).toEqual({
      from: "2026-04-16",
      to: "2026-05-15",
    });
  });

  it("90d → today − 89 to today", () => {
    expect(resolveDateRange({ preset: "90d" }).from).toBe("2026-02-15");
  });

  it("custom uses provided dates", () => {
    expect(
      resolveDateRange({
        preset: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
      })
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("custom without dates falls back to 30d", () => {
    expect(resolveDateRange({ preset: "custom" })).toEqual({
      from: "2026-04-16",
      to: "2026-05-15",
    });
  });

  it("custom with only from falls back to 30d (incomplete custom)", () => {
    expect(resolveDateRange({ preset: "custom", from: "2026-01-01" })).toEqual({
      from: "2026-04-16",
      to: "2026-05-15",
    });
  });
});
