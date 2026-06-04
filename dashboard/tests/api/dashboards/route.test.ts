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

describe("GET /api/dashboards", () => {
  it("401 when unauth", async () => {
    const { requireUser } = await import("@/lib/auth/require-user");
    (requireUser as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error("unauth"));

    const { GET } = await import("@/app/api/dashboards/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns dashboards filtered by user + school", async () => {
    const eqUser = vi.fn().mockReturnThis();
    const eqSchool = vi.fn().mockReturnThis();
    const order = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "d1", name: "Funnel A" }], error: null });
    const select = vi.fn().mockReturnValue({
      eq: eqUser.mockReturnValue({
        eq: eqSchool.mockReturnValue({ order }),
      }),
    });

    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({ select }),
    });

    const { GET } = await import("@/app/api/dashboards/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dashboards: unknown[] };
    expect(body.dashboards).toHaveLength(1);
    expect(eqUser).toHaveBeenCalledWith("created_by", "u1");
    expect(eqSchool).toHaveBeenCalledWith("school_slug", "efap");
  });
});

describe("POST /api/dashboards", () => {
  it("400 on empty name", async () => {
    const { POST } = await import("@/app/api/dashboards/route");
    const res = await POST(
      new Request("http://x/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates dashboard with current user + school", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: "d-new" }, error: null }),
      }),
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({ insert }),
    });

    const { POST } = await import("@/app/api/dashboards/route");
    const res = await POST(
      new Request("http://x/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Funnel JPO" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("d-new");
    expect(insert).toHaveBeenCalledWith({
      school_slug: "efap",
      created_by: "u1",
      name: "Funnel JPO",
    });
  });
});
