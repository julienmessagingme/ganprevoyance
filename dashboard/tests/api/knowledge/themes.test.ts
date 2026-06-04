import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/schools/context", () => ({
  getCurrentSchoolSlug: vi.fn().mockResolvedValue("efap"),
  getCurrentSchoolSlugChecked: vi.fn().mockResolvedValue("efap"),
  SCHOOL_COOKIE_NAME: "edh_school",
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u1", email: "a@b.c" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("POST /api/knowledge/themes", () => {
  it("400 on empty name", async () => {
    const { POST } = await import("@/app/api/knowledge/themes/route");
    const res = await POST(
      new Request("http://x/api/knowledge/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates a theme on the current school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "t1", name: "Tarifs", created_at: "2026-04-30" },
            error: null,
          }),
      }),
    });
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({ insert }),
    });

    const { POST } = await import("@/app/api/knowledge/themes/route");
    const res = await POST(
      new Request("http://x/api/knowledge/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tarifs" }),
      })
    );

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({ school_slug: "efap", name: "Tarifs" });
  });

  it("409 on duplicate (Postgres 23505)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { code: "23505", message: "unique violation" },
              }),
          }),
        }),
      }),
    });

    const { POST } = await import("@/app/api/knowledge/themes/route");
    const res = await POST(
      new Request("http://x/api/knowledge/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Existant" }),
      })
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("duplicate");
  });
});

describe("DELETE /api/knowledge/themes/:id", () => {
  it("404 when theme is owned by another school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "t1", school_slug: "icart" }, // not 'efap'
                error: null,
              }),
          }),
        }),
      }),
    });

    const { DELETE } = await import("@/app/api/knowledge/themes/[id]/route");
    const res = await DELETE(new Request("http://x/api/knowledge/themes/t1"), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes theme owned by current school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    const deleteCall = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "t1", school_slug: "efap" },
                error: null,
              }),
          }),
        }),
        delete: deleteCall,
      }),
    });

    const { DELETE } = await import("@/app/api/knowledge/themes/[id]/route");
    const res = await DELETE(new Request("http://x/api/knowledge/themes/t1"), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(200);
    expect(deleteCall).toHaveBeenCalled();
  });
});
