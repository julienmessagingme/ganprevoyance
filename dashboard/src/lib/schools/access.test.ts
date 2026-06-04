import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
});

function setRows(rows: { school_slug: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  };
}

describe("getCurrentUserSchools", () => {
  it("returns the user's school slugs ordered by SCHOOLS constant", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([
        { school_slug: "icart" },
        { school_slug: "efap" },
        { school_slug: "3wa" },
      ])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    const slugs = await getCurrentUserSchools("u1");
    // Constant order : efap before 3wa before icart
    expect(slugs).toEqual(["efap", "3wa", "icart"]);
  });

  it("returns empty array when user has no rows", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    expect(await getCurrentUserSchools("u1")).toEqual([]);
  });

  it("filters out unknown slugs (defensive)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(
      setRows([
        { school_slug: "efap" },
        { school_slug: "old-renamed-school" }, // n'existe plus dans SCHOOLS
      ])
    );
    const { getCurrentUserSchools } = await import("@/lib/schools/access");
    expect(await getCurrentUserSchools("u1")).toEqual(["efap"]);
  });

});
