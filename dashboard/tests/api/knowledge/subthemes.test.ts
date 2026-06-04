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

describe("POST /api/knowledge/subthemes", () => {
  it("rejects themeId belonging to another school (400)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (t: string) => {
        if (t === "knowledge_themes") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { school_slug: "icart" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {};
      },
    });

    const { POST } = await import("@/app/api/knowledge/subthemes/route");
    const res = await POST(
      new Request("http://x/api/knowledge/subthemes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Sub",
          themeId: "00000000-0000-0000-0000-000000000001",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates standalone subtheme (no themeId)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "s1", name: "Sub", theme_id: null, created_at: "x" },
            error: null,
          }),
      }),
    });
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({ insert }),
    });

    const { POST } = await import("@/app/api/knowledge/subthemes/route");
    const res = await POST(
      new Request("http://x/api/knowledge/subthemes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Sub" }),
      })
    );
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      school_slug: "efap",
      name: "Sub",
      theme_id: null,
    });
  });
});
