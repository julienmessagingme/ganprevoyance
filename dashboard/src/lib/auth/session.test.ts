import { describe, it, expect, beforeAll } from "vitest";

describe("auth session", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "0".repeat(64);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
    process.env.INTERNAL_API_KEY = "x";
  });

  it("signs and verifies a session token round-trip", async () => {
    const { signSession, verifySession } = await import("./session");
    const token = await signSession({ userId: "u1", email: "a@b.c" });
    const payload = await verifySession(token);
    expect(payload?.userId).toBe("u1");
    expect(payload?.email).toBe("a@b.c");
  });

  it("returns null on tampered token", async () => {
    const { signSession, verifySession } = await import("./session");
    const token = await signSession({ userId: "u1", email: "a@b.c" });
    const bad = token.slice(0, -3) + "AAA";
    const payload = await verifySession(bad);
    expect(payload).toBeNull();
  });
});
