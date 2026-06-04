import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service");
vi.mock("@/lib/messagingme/client");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  process.env.AUTH_SECRET = "0".repeat(64);
  process.env.INTERNAL_API_KEY = "x";
});

describe("syncSchool watermark", () => {
  it("ingests everything the cursor returns and bumps the watermark to the max id", async () => {
    const clientMod = await import("@/lib/messagingme/client");
    vi.spyOn(clientMod, "listEvents").mockResolvedValue([
      {
        name: "a",
        event_ns: "ns1",
        description: "",
        text_label: "",
        price_label: "",
        number_label: "",
      },
    ]);

    // Le mock simule le contrat réel de l'API : le curseur `start_id` est
    // EXCLUSIF et les ids sont croissants, donc on ne renvoie que id > startId.
    // Le sync ne filtre plus côté client (plus de break précoce) — il fait
    // confiance au curseur. Avec watermark=99, seuls 100 et 101 reviennent.
    vi.spyOn(clientMod, "iterOccurrences").mockImplementation(
      async function* (
        _opts: unknown,
        _ns: string,
        startId = 0
      ): AsyncGenerator<unknown[], void, void> {
        const all = [98, 99, 100, 101].map((id) => ({
          id,
          user_ns: "u",
          event_ns: "ns1",
          text_value: "",
          price_value: "0",
          number_value: 1,
          created_at: "2026-04-01T00:00:00Z",
        }));
        yield all.filter((o) => o.id > startId);
      } as never
    );

    const inserts: { id: number }[] = [];
    const upserts: { table: string; row: Record<string, unknown> }[] = [];

    const sbMock = {
      from: (t: string) => {
        if (t === "mm_events") {
          return {
            upsert: (rows: Record<string, unknown>) => {
              upserts.push({ table: t, row: rows });
              return Promise.resolve({ error: null });
            },
          };
        }
        if (t === "mm_occurrences") {
          return {
            upsert: (rows: { id: number }[]) => {
              for (const r of rows) inserts.push({ id: r.id });
              return Promise.resolve({ error: null });
            },
          };
        }
        if (t === "mm_sync_state") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { last_occurrence_id: 99 },
                      error: null,
                    }),
                }),
              }),
            }),
            upsert: (row: Record<string, unknown>) => {
              upserts.push({ table: t, row });
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      },
    };

    const svc = await import("@/lib/supabase/service");
    (
      svc.getSupabase as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue(sbMock);
    (
      svc.getSupabaseScoped as unknown as {
        mockReturnValue: (v: unknown) => void;
      }
    ).mockReturnValue(sbMock);

    const { syncSchool } = await import("./sync");
    await syncSchool(
      {
        slug: "gan-prev",
        name: "Gan Prévoyance",
        tokenEnv: "MM_TOKEN_GANPREV",
        vectorStoreEnv: "OPENAI_VS_GANPREV",
        logo: "/logos/ganprev.png",
      },
      "tok"
    );

    // Watermark 99 → le curseur (start_id=99) ne renvoie que 100 et 101, et tout
    // est ingéré (aucun break côté client).
    expect(inserts.map((r) => r.id)).toEqual([100, 101]);

    // Watermark avancé au max id réellement inséré (101).
    const stateUpserts = upserts.filter((u) => u.table === "mm_sync_state");
    const watermarkUpdate = stateUpserts.find(
      (u) => u.row.last_occurrence_id === 101
    );
    expect(watermarkUpdate).toBeDefined();
  });
});
