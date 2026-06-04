import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_VS_EFAP = "vs_efap_test";
  delete process.env.OPENAI_VS_3WA;
});

describe("getVectorStoreId", () => {
  it("returns the env value when set", async () => {
    const { getVectorStoreId } = await import("./openai-kb");
    expect(getVectorStoreId("efap")).toBe("vs_efap_test");
  });

  it("throws when env var missing", async () => {
    const { getVectorStoreId } = await import("./openai-kb");
    expect(() => getVectorStoreId("3wa")).toThrow(/Vector store id not configured/);
  });

  it("throws on unknown school", async () => {
    const { getVectorStoreId } = await import("./openai-kb");
    expect(() => getVectorStoreId("nope")).toThrow(/Vector store id not configured/);
  });
});

describe("uploadToVectorStore", () => {
  it("posts to /files then to /vector_stores/{id}/files with the right headers", async () => {
    // Mock the OpenAI SDK files.create to return a fake file id.
    vi.doMock("openai", () => ({
      default: class {
        files = {
          create: vi.fn().mockResolvedValue({ id: "file-abc" }),
          delete: vi.fn(),
        };
      },
    }));

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "vsf-xyz", status: "completed" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { uploadToVectorStore } = await import("./openai-kb");
    const r = await uploadToVectorStore(
      "efap",
      Buffer.from("hello"),
      "doc.txt",
      { skipIndexation: true }
    );

    expect(r.fileId).toBe("file-abc");
    expect(r.vectorStoreFileId).toBe("vsf-xyz");
    expect(r.status).toBe("completed");

    // Verify the vector store call was made with the right url + headers.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/vector_stores/vs_efap_test/files",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "OpenAI-Beta": "assistants=v2",
        }),
      })
    );
  });

  it("retries on 5xx then succeeds", async () => {
    vi.doMock("openai", () => ({
      default: class {
        files = {
          create: vi.fn().mockResolvedValue({ id: "file-abc" }),
          delete: vi.fn(),
        };
      },
    }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "vsf-xyz", status: "completed" }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { uploadToVectorStore } = await import("./openai-kb");
    await uploadToVectorStore("efap", Buffer.from("x"), "doc.txt", { skipIndexation: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on 4xx without retry", async () => {
    vi.doMock("openai", () => ({
      default: class {
        files = {
          create: vi.fn().mockResolvedValue({ id: "file-abc" }),
          delete: vi.fn(),
        };
      },
    }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { uploadToVectorStore } = await import("./openai-kb");
    await expect(
      uploadToVectorStore("efap", Buffer.from("x"), "doc.txt", { skipIndexation: true })
    ).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("deleteFromVectorStore", () => {
  it("calls DELETE on the right url and tolerates 404", async () => {
    vi.doMock("openai", () => ({
      default: class {
        files = { create: vi.fn(), delete: vi.fn() };
      },
    }));

    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { deleteFromVectorStore } = await import("./openai-kb");
    await deleteFromVectorStore("efap", "vsf-xyz");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/vector_stores/vs_efap_test/files/vsf-xyz",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
