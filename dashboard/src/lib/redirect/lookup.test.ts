import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  getSupabase: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("lookupSlug", () => {
  it("returns null when slug is not found", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });
    const { lookupSlug } = await import("./lookup");
    expect(await lookupSlug("nope")).toBeNull();
  });

  it("returns event + active version when present", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "redirect_events") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { id: "e1", slug: "abc", school_slug: "efap" },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        // redirect_versions
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "v1", destination_url: "https://x.test/p", version: 1 },
                    error: null,
                  }),
                }),
            }),
          }),
        };
      },
    });
    const { lookupSlug } = await import("./lookup");
    const r = await lookupSlug("abc");
    expect(r?.destinationUrl).toBe("https://x.test/p");
    expect(r?.eventId).toBe("e1");
    expect(r?.schoolSlug).toBe("efap");
  });
});
