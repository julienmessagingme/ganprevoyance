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

/**
 * Owner-only mock : `dashboards.select(...).eq('id',...).maybeSingle()`
 * returns the provided ownerData. Other tables fall through to the
 * `dashboards` shape too — so use this only when the test never reaches
 * past the ownership probe (e.g. 404 / 400 / DELETE-only paths).
 */
function ownerOnlyMock(
  ownerData: { id: string; created_by: string; school_slug: string } | null
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: ownerData, error: null }),
        }),
      }),
    }),
  };
}

describe("GET /api/dashboards/[id]", () => {
  it("404 when not owned by current user", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "OTHER", school_slug: "efap" })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/route");
    const res = await GET(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 when dashboard belongs to another school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "u1", school_slug: "icart" })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/route");
    const res = await GET(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns dashboard with steps and their refs grouped", async () => {
    let dashboardsCall = 0;
    const fromImpl = (table: string) => {
      if (table === "dashboards") {
        dashboardsCall += 1;
        // 1st call = ownership probe (maybeSingle)
        if (dashboardsCall === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "d1", created_by: "u1", school_slug: "efap" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        // 2nd call = full select (single)
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "d1",
                    school_slug: "efap",
                    created_by: "u1",
                    name: "F1",
                    type: "funnel",
                    date_preset: "30d",
                    date_from: null,
                    date_to: null,
                    created_at: "x",
                    updated_at: "y",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "dashboard_steps") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    { id: "s1", position: 0, label: "Relances" },
                    { id: "s2", position: 1, label: null },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "dashboard_step_refs") {
        return {
          select: () => ({
            in: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "r1",
                      step_id: "s1",
                      ref_position: 0,
                      step_type: "mm_event",
                      event_ns: "evt_a",
                      redirect_event_id: null,
                    },
                    {
                      id: "r2",
                      step_id: "s1",
                      ref_position: 1,
                      step_type: "mm_event",
                      event_ns: "evt_b",
                      redirect_event_id: null,
                    },
                    {
                      id: "r3",
                      step_id: "s2",
                      ref_position: 0,
                      step_type: "url_click",
                      event_ns: null,
                      redirect_event_id:
                        "11111111-1111-4111-8111-111111111111",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: fromImpl,
    });

    const { GET } = await import("@/app/api/dashboards/[id]/route");
    const res = await GET(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dashboard: {
        steps: Array<{ id: string; label: string | null; refs: unknown[] }>;
      };
    };
    expect(body.dashboard.steps).toHaveLength(2);
    expect(body.dashboard.steps[0].label).toBe("Relances");
    expect(body.dashboard.steps[0].refs).toHaveLength(2);
    expect(body.dashboard.steps[1].label).toBeNull();
    expect(body.dashboard.steps[1].refs).toHaveLength(1);
  });

  it("returns dashboard with empty steps array when none", async () => {
    let dashboardsCall = 0;
    const fromImpl = (table: string) => {
      if (table === "dashboards") {
        dashboardsCall += 1;
        if (dashboardsCall === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "d1", created_by: "u1", school_slug: "efap" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "d1",
                    school_slug: "efap",
                    created_by: "u1",
                    name: "F1",
                    type: "funnel",
                    date_preset: "30d",
                    date_from: null,
                    date_to: null,
                    created_at: "x",
                    updated_at: "y",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "dashboard_steps") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: fromImpl,
    });

    const { GET } = await import("@/app/api/dashboards/[id]/route");
    const res = await GET(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dashboard: { steps: unknown[] };
    };
    expect(body.dashboard.steps).toEqual([]);
  });
});

describe("PATCH /api/dashboards/[id]", () => {
  it("400 on empty body", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "u1", school_slug: "efap" })
    );

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("404 when not owned", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "OTHER", school_slug: "efap" })
    );

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renommed" }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("updates name only (no steps replace)", async () => {
    const update = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "dashboards") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "d1", created_by: "u1", school_slug: "efap" },
                    error: null,
                  }),
              }),
            }),
            update,
          };
        }
        return {};
      },
    });

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renommed" }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
    const arg = update.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("Renommed");
  });

  it("replaces steps atomically via RPC (cumul: 1 step with 3 refs, mixed types)", async () => {
    // Depuis migration 007, le PATCH passe par la RPC PL/pgSQL
    // `replace_dashboard_steps` (atomique côté Postgres) plutôt que par
    // une séquence DELETE + N inserts côté JS. Le mock vérifie juste
    // que la RPC est appelée avec le bon payload.
    const rpc = vi.fn().mockResolvedValue({ error: null });

    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "dashboards") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "d1", created_by: "u1", school_slug: "efap" },
                    error: null,
                  }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      rpc,
    });

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steps: [
            {
              label: "Relances cumul",
              refs: [
                { step_type: "mm_event", event_ns: "evt_a" },
                { step_type: "mm_event", event_ns: "evt_b" },
                {
                  step_type: "url_click",
                  redirect_event_id: "11111111-1111-4111-8111-111111111111",
                },
              ],
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("replace_dashboard_steps");
    const payload = rpc.mock.calls[0][1] as {
      p_dashboard_id: string;
      p_steps: Array<{
        label: string | null;
        refs: Array<{
          step_type: string;
          event_ns: string | null;
          redirect_event_id: string | null;
          event_school_slug: string | null;
        }>;
      }>;
    };
    expect(payload.p_dashboard_id).toBe("d1");
    expect(payload.p_steps).toHaveLength(1);
    expect(payload.p_steps[0].label).toBe("Relances cumul");
    expect(payload.p_steps[0].refs).toHaveLength(3);
    expect(payload.p_steps[0].refs[0]).toMatchObject({
      step_type: "mm_event",
      event_ns: "evt_a",
      redirect_event_id: null,
    });
    expect(payload.p_steps[0].refs[2]).toMatchObject({
      step_type: "url_click",
      event_ns: null,
    });
  });

  it("400 on empty refs array", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "u1", school_slug: "efap" })
    );

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steps: [{ refs: [] }],
        }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("400 on invalid ref (mm_event without event_ns)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "u1", school_slug: "efap" })
    );

    const { PATCH } = await import("@/app/api/dashboards/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/dashboards/d1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steps: [{ refs: [{ step_type: "mm_event" }] }],
        }),
      }),
      { params: Promise.resolve({ id: "d1" }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/dashboards/[id]", () => {
  it("404 when not owned", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      ownerOnlyMock({ id: "d1", created_by: "OTHER", school_slug: "efap" })
    );

    const { DELETE } = await import("@/app/api/dashboards/[id]/route");
    const res = await DELETE(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes when owned", async () => {
    const deleteFn = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "d1", created_by: "u1", school_slug: "efap" },
                error: null,
              }),
          }),
        }),
        delete: deleteFn,
      }),
    });

    const { DELETE } = await import("@/app/api/dashboards/[id]/route");
    const res = await DELETE(new Request("http://x/api/dashboards/d1"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(200);
    expect(deleteFn).toHaveBeenCalled();
  });
});
