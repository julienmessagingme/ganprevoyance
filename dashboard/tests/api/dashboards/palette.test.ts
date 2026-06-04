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

describe("GET /api/dashboards/palette", () => {
  it("401 when unauth", async () => {
    const { requireUser } = await import("@/lib/auth/require-user");
    (requireUser as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error("unauth"));
    const { GET } = await import("@/app/api/dashboards/palette/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns mm_events + active redirect_events for current school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "mm_events") {
          // .select().order("school_slug").order("name").eq("school_slug", X)
          return {
            select: () => ({
              order: () => ({
                order: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          school_slug: "efap",
                          event_ns: "evt_a",
                          name: "Relance benin",
                        },
                        {
                          school_slug: "efap",
                          event_ns: "evt_b",
                          name: "Remplissage dossier",
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        // redirect_events : .select().is().order().order().eq()
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                order: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "uuid-1",
                          name: "Clic JPO",
                          school_slug: "efap",
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      },
    });

    const { GET } = await import("@/app/api/dashboards/palette/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mmEvents: Array<{
        step_type: string;
        ref_id: string;
        label: string;
        school_slug?: string;
      }>;
      redirectEvents: Array<{
        step_type: string;
        ref_id: string;
        label: string;
        school_slug?: string;
      }>;
    };
    expect(body.mmEvents).toHaveLength(2);
    // En mode école-précise, ref_id = event_ns brut, et school_slug est
    // omis sur l'item palette (il est implicite via le scope).
    expect(body.mmEvents[0]).toEqual({
      step_type: "mm_event",
      ref_id: "evt_a",
      label: "Relance benin",
    });
    expect(body.redirectEvents).toHaveLength(1);
    expect(body.redirectEvents[0]).toEqual({
      step_type: "url_click",
      ref_id: "uuid-1",
      label: "Clic JPO",
    });
  });
});
