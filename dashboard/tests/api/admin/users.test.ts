import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u-me", email: "me@x.com" }),
  requireAdmin: vi.fn().mockResolvedValue({ userId: "u-me", email: "me@x.com" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("GET /api/admin/users", () => {
  it("403 when not admin", async () => {
    const { requireAdmin } = await import("@/lib/auth/require-user");
    (requireAdmin as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));

    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns users with their school accesses", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "users") {
          return {
            select: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "u1",
                      email: "a@x",
                      name: "A",
                      is_admin: true,
                      deactivated_at: null,
                      last_login_at: null,
                      created_at: "2026-01-01",
                    },
                    {
                      id: "u2",
                      email: "b@x",
                      name: "B",
                      is_admin: false,
                      deactivated_at: null,
                      last_login_at: null,
                      created_at: "2026-01-02",
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === "user_school_access") {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    { user_id: "u1", school_slug: "efap" },
                    { user_id: "u1", school_slug: "icart" },
                    { user_id: "u2", school_slug: "efap" },
                  ],
                  error: null,
                }),
            }),
          };
        }
        throw new Error(`Unexpected: ${table}`);
      },
    });

    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ id: string; schools: string[] }>;
    };
    expect(body.users).toHaveLength(2);
    expect(body.users[0].schools).toEqual(["efap", "icart"]);
    expect(body.users[1].schools).toEqual(["efap"]);
  });
});

describe("POST /api/admin/users", () => {
  it("400 on invalid body (short password)", async () => {
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "x@x.com",
          name: "X",
          password: "short",
          is_admin: false,
          schools: [],
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates user + school access rows", async () => {
    const userInsertSelect = vi.fn().mockReturnValue({
      single: () => Promise.resolve({ data: { id: "u-new" }, error: null }),
    });
    const userInsert = vi.fn().mockReturnValue({ select: userInsertSelect });
    const accessInsert = vi.fn().mockResolvedValue({ error: null });

    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "users") return { insert: userInsert };
        if (table === "user_school_access") return { insert: accessInsert };
        throw new Error(`Unexpected: ${table}`);
      },
    });

    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "Newcomer@X.com",
          name: "Newcomer",
          password: "supersecret",
          is_admin: false,
          schools: ["efap", "icart"],
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(userInsert).toHaveBeenCalled();
    const userArg = userInsert.mock.calls[0][0] as Record<string, unknown>;
    // email lowercased by Zod transform
    expect(userArg.email).toBe("newcomer@x.com");
    expect(userArg.password_hash).toMatch(/^\$2[aby]\$/);
    expect(accessInsert).toHaveBeenCalled();
    const rows = accessInsert.mock.calls[0][0] as Array<{ school_slug: string }>;
    expect(rows.map((r) => r.school_slug).sort()).toEqual(["efap", "icart"]);
  });

  it("409 on duplicate email (Postgres 23505)", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              }),
          }),
        }),
      }),
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "exists@x.com",
          name: "X",
          password: "supersecret",
          is_admin: false,
          schools: [],
        }),
      })
    );
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("400 when trying to deactivate self", async () => {
    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "u-me" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when target is the only active admin", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: (table: string) => {
        if (table === "users") {
          // Both the lookup and the count(*) admins go through users.
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count === "exact" && opts.head) {
                return {
                  eq: () => ({
                    is: () => ({
                      neq: () => Promise.resolve({ count: 0, error: null }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: "target",
                        is_admin: true,
                        deactivated_at: null,
                      },
                      error: null,
                    }),
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected: ${table}`);
      },
    });

    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "target" }),
    });
    expect(res.status).toBe(400);
  });

  it("soft-deletes (UPDATE deactivated_at) when target is non-admin", async () => {
    const update = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    });
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: "u2", is_admin: false, deactivated_at: null },
                error: null,
              }),
          }),
        }),
        update,
      }),
    });

    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "u2" }),
    });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
    const arg = update.mock.calls[0][0] as { deactivated_at: string };
    expect(typeof arg.deactivated_at).toBe("string");
  });
});
