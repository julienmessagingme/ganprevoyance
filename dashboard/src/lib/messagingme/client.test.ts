import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("listEvents", () => {
  it("paginates and aggregates results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "a",
                event_ns: "1",
                description: "",
                text_label: "",
                price_label: "",
                number_label: "",
              },
            ],
            meta: { current_page: 1, last_page: 2 },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "b",
                event_ns: "2",
                description: "",
                text_label: "",
                price_label: "",
                number_label: "",
              },
            ],
            meta: { current_page: 2, last_page: 2 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    const r = await listEvents({ token: "t", base: "https://api.test/api" });
    expect(r.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.map((e) => e.event_ns)).toEqual(["1", "2"]);
  });

  it("throws on 4xx without retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    await expect(
      listEvents({ token: "bad", base: "https://api.test/api" })
    ).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [],
            meta: { current_page: 1, last_page: 1 },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { listEvents } = await import("./client");
    const r = await listEvents({ token: "t", base: "https://api.test/api" });
    expect(r).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("iterOccurrences", () => {
  it("walks the ascending start_id cursor until a short page", async () => {
    // Contrat API (cf. LEARNINGS 2026-06-02) : ids croissants, start_id curseur
    // exclusif, limit cap 100. La pagination s'arrête à la première page < limit.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const page2 = [{ id: 101 }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: page1, meta: { total: 101 } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: page2, meta: { total: 101 } }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { iterOccurrences } = await import("./client");
    const collected: number[] = [];
    for await (const batch of iterOccurrences(
      { token: "t", base: "https://api.test/api" },
      "ns1"
    )) {
      for (const r of batch) collected.push((r as { id: number }).id);
    }
    expect(collected.length).toBe(101);
    expect(collected[0]).toBe(1);
    expect(collected[100]).toBe(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 1er appel curseur 0, 2e appel curseur = max id de la page 1 (100).
    expect(fetchMock.mock.calls[0][0] as string).toContain("start_id=0");
    expect(fetchMock.mock.calls[0][0] as string).toContain("limit=100");
    expect(fetchMock.mock.calls[1][0] as string).toContain("start_id=100");
  });

  it("starts from a provided watermark and stops on an empty page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { iterOccurrences } = await import("./client");
    const collected: number[] = [];
    for await (const batch of iterOccurrences(
      { token: "t", base: "https://api.test/api" },
      "ns1",
      500
    )) {
      for (const r of batch) collected.push((r as { id: number }).id);
    }
    expect(collected).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0] as string).toContain("start_id=500");
  });
});
