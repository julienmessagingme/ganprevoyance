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
vi.mock("@/lib/openai-kb", () => ({
  deleteFromVectorStore: vi.fn().mockResolvedValue(undefined),
  deleteOpenAIFile: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_VS_EFAP = "vs_efap";
});

describe("DELETE /api/knowledge/items/:id", () => {
  it("404 when item belongs to another school", async () => {
    const { getSupabase } = await import("@/lib/supabase/service");
    (getSupabase as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "i1",
                  school_slug: "icart",
                  vector_store_file_id: "vsf",
                  openai_file_id: "f1",
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const { DELETE } = await import("@/app/api/knowledge/items/[id]/route");
    const res = await DELETE(
      new Request("http://x/api/knowledge/items/i1"),
      { params: Promise.resolve({ id: "i1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("deletes item + calls OpenAI cleanup", async () => {
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
                data: {
                  id: "i1",
                  school_slug: "efap",
                  vector_store_file_id: "vsf",
                  openai_file_id: "f1",
                },
                error: null,
              }),
          }),
        }),
        delete: deleteCall,
      }),
    });

    const { DELETE } = await import("@/app/api/knowledge/items/[id]/route");
    const res = await DELETE(
      new Request("http://x/api/knowledge/items/i1"),
      { params: Promise.resolve({ id: "i1" }) }
    );
    expect(res.status).toBe(200);
    expect(deleteCall).toHaveBeenCalled();

    const { deleteFromVectorStore, deleteOpenAIFile } = await import(
      "@/lib/openai-kb"
    );
    expect(deleteFromVectorStore).toHaveBeenCalledWith("efap", "vsf");
    expect(deleteOpenAIFile).toHaveBeenCalledWith("f1");
  });

  it("does not abort the DB delete if OpenAI delete fails", async () => {
    const { deleteFromVectorStore } = await import("@/lib/openai-kb");
    (deleteFromVectorStore as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error("vector store down")
    );

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
                data: {
                  id: "i1",
                  school_slug: "efap",
                  vector_store_file_id: "vsf",
                  openai_file_id: "f1",
                },
                error: null,
              }),
          }),
        }),
        delete: deleteCall,
      }),
    });

    const { DELETE } = await import("@/app/api/knowledge/items/[id]/route");
    const res = await DELETE(
      new Request("http://x/api/knowledge/items/i1"),
      { params: Promise.resolve({ id: "i1" }) }
    );
    expect(res.status).toBe(200);
    expect(deleteCall).toHaveBeenCalled(); // DB delete still happened
  });
});
