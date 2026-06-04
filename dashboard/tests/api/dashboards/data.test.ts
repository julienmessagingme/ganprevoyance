import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-15T12:34:56Z"));
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

afterEach(() => vi.useRealTimers());

interface OwnerData {
  id: string;
  created_by: string;
  school_slug: string;
  date_preset: string;
  date_from: string | null;
  date_to: string | null;
}

interface MockOpts {
  ownerData: OwnerData | null;
  steps?: Array<{ id: string; position: number; label: string | null }>;
  refs?: Array<{
    id: string;
    step_id: string;
    ref_position: number;
    step_type: "mm_event" | "url_click";
    event_ns: string | null;
    redirect_event_id: string | null;
    /** En mode école-précise, NULL : la route se rabat sur le school du
     *  dashboard. En mode EDH groupe, l'école d'origine du mm_event. */
    event_school_slug?: string | null;
  }>;
  /** Le route data filtre par school_slug, donc le mock doit injecter le
   *  school_slug. Par défaut on l'aligne sur ownerData.school_slug. */
  mmLabels?: Array<{ event_ns: string; name: string; school_slug?: string }>;
  redirectLabels?: Array<{ id: string; name: string; school_slug: string }>;
  /** Counts returned by mm_occurrences in order of appearance. */
  mmCounts?: number[];
  /** Counts returned by clicks in order of appearance. */
  clickCounts?: number[];
}

function buildSupabaseMock(opts: MockOpts) {
  let mmCountIdx = 0;
  let clickCountIdx = 0;
  return {
    from: (table: string) => {
      if (table === "dashboards") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: opts.ownerData, error: null }),
            }),
          }),
        };
      }
      if (table === "dashboard_steps") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({ data: opts.steps ?? [], error: null }),
            }),
          }),
        };
      }
      if (table === "dashboard_step_refs") {
        return {
          select: () => ({
            in: () => ({
              order: () =>
                Promise.resolve({ data: opts.refs ?? [], error: null }),
            }),
          }),
        };
      }
      if (table === "mm_events") {
        // Nouveau shape : .select().in("school_slug", involvedSchools).
        // Chaque mmLabel doit porter school_slug pour que la route le
        // matche (clé composite (school_slug, event_ns)). On assume
        // ownerData.school_slug par défaut.
        const ownerSchool = opts.ownerData?.school_slug ?? "efap";
        const labels = (opts.mmLabels ?? []).map((l) => ({
          school_slug: l.school_slug ?? ownerSchool,
          event_ns: l.event_ns,
          name: l.name,
        }));
        return {
          select: () => ({
            in: () => Promise.resolve({ data: labels, error: null }),
          }),
        };
      }
      if (table === "redirect_events") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: opts.redirectLabels ?? [], error: null }),
          }),
        };
      }
      if (table === "mm_occurrences") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lt: () =>
                    Promise.resolve({
                      count: (opts.mmCounts ?? [])[mmCountIdx++] ?? 0,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "clicks") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lt: () =>
                  Promise.resolve({
                    count: (opts.clickCounts ?? [])[clickCountIdx++] ?? 0,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("GET /api/dashboards/[id]/data — multi-refs", () => {
  it("404 when not owned", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      buildSupabaseMock({
        ownerData: {
          id: "d1",
          created_by: "OTHER",
          school_slug: "efap",
          date_preset: "30d",
          date_from: null,
          date_to: null,
        },
      })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/data/route");
    const res = await GET(new Request("http://x/api/dashboards/d1/data"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(404);
  });

  it("sums refs of the same step (cumul)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      buildSupabaseMock({
        ownerData: {
          id: "d1",
          created_by: "u1",
          school_slug: "efap",
          date_preset: "30d",
          date_from: null,
          date_to: null,
        },
        steps: [
          { id: "s1", position: 0, label: "Relances cumul" },
          { id: "s2", position: 1, label: null },
        ],
        refs: [
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
            step_id: "s1",
            ref_position: 2,
            step_type: "url_click",
            event_ns: null,
            redirect_event_id: "11111111-1111-4111-8111-111111111111",
          },
          {
            id: "r4",
            step_id: "s2",
            ref_position: 0,
            step_type: "mm_event",
            event_ns: "evt_c",
            redirect_event_id: null,
          },
        ],
        mmLabels: [
          { event_ns: "evt_a", name: "Relance V1" },
          { event_ns: "evt_b", name: "Relance V2" },
          { event_ns: "evt_c", name: "Engagement" },
        ],
        redirectLabels: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Clic teaser",
            school_slug: "efap",
          },
        ],
        mmCounts: [1000, 500, 300],
        clickCounts: [30],
      })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/data/route");
    const res = await GET(new Request("http://x/api/dashboards/d1/data"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      steps: Array<{
        position: number;
        label: string;
        count: number;
        available: boolean;
        refs: Array<{ count: number; available: boolean; label: string }>;
      }>;
    };
    expect(body.steps).toHaveLength(2);

    // Step 0: 1000 + 500 + 30 = 1530, custom label
    expect(body.steps[0].count).toBe(1530);
    expect(body.steps[0].label).toBe("Relances cumul");
    expect(body.steps[0].available).toBe(true);
    expect(body.steps[0].refs).toHaveLength(3);

    // Step 1: 300, fallback label = single ref name
    expect(body.steps[1].count).toBe(300);
    expect(body.steps[1].label).toBe("Engagement");
  });

  it("excludes unavailable refs from sum but keeps step available if any ref OK", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      buildSupabaseMock({
        ownerData: {
          id: "d1",
          created_by: "u1",
          school_slug: "efap",
          date_preset: "30d",
          date_from: null,
          date_to: null,
        },
        steps: [{ id: "s1", position: 0, label: null }],
        refs: [
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
            event_ns: "evt_gone",
            redirect_event_id: null,
          },
        ],
        mmLabels: [{ event_ns: "evt_a", name: "Relance V1" }],
        mmCounts: [777],
      })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/data/route");
    const res = await GET(new Request("http://x/api/dashboards/d1/data"), {
      params: Promise.resolve({ id: "d1" }),
    });
    const body = (await res.json()) as {
      steps: Array<{
        count: number;
        available: boolean;
        label: string;
        refs: Array<{ available: boolean; label: string }>;
      }>;
    };
    expect(body.steps[0].count).toBe(777);
    expect(body.steps[0].available).toBe(true);
    expect(body.steps[0].refs[1].available).toBe(false);
    expect(body.steps[0].refs[1].label).toBe("(indisponible)");
    // Fallback label uses ref labels joined with " + "
    expect(body.steps[0].label).toBe("Relance V1 + (indisponible)");
  });

  it("step is unavailable when all refs are unavailable", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      buildSupabaseMock({
        ownerData: {
          id: "d1",
          created_by: "u1",
          school_slug: "efap",
          date_preset: "7d",
          date_from: null,
          date_to: null,
        },
        steps: [{ id: "s1", position: 0, label: null }],
        refs: [
          {
            id: "r1",
            step_id: "s1",
            ref_position: 0,
            step_type: "mm_event",
            event_ns: "evt_gone",
            redirect_event_id: null,
          },
        ],
        mmLabels: [],
      })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/data/route");
    const res = await GET(new Request("http://x/api/dashboards/d1/data"), {
      params: Promise.resolve({ id: "d1" }),
    });
    const body = (await res.json()) as {
      steps: Array<{ available: boolean; count: number }>;
    };
    expect(body.steps[0].available).toBe(false);
    expect(body.steps[0].count).toBe(0);
  });

  it("returns empty steps array when dashboard has none", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      buildSupabaseMock({
        ownerData: {
          id: "d1",
          created_by: "u1",
          school_slug: "efap",
          date_preset: "30d",
          date_from: null,
          date_to: null,
        },
        steps: [],
      })
    );

    const { GET } = await import("@/app/api/dashboards/[id]/data/route");
    const res = await GET(new Request("http://x/api/dashboards/d1/data"), {
      params: Promise.resolve({ id: "d1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { steps: unknown[] };
    expect(body.steps).toEqual([]);
  });
});
