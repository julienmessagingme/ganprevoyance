export interface MmEvent {
  name: string;
  event_ns: string;
  description: string;
  text_label: string;
  price_label: string;
  number_label: string;
}

export interface MmOccurrence {
  id: number;
  user_ns: string;
  event_ns: string;
  text_value: string;
  price_value: string;
  number_value: number;
  created_at: string;
}

interface PaginatedResponse<T> {
  data: T[];
  // `listEvents` (catalogue, page-based) lit current_page/last_page.
  // `iterOccurrences` (data, curseur start_id) n'utilise QUE `data` et ignore meta.
  meta: { current_page: number; last_page: number };
}

export interface ClientOpts {
  token: string;
  base: string;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, init);
      // Retry only on 5xx (server errors / transient). 4xx are deterministic
      // (auth, rate-limit, bad params) — fail fast.
      if (r.status >= 500 && attempt < retries) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      return r;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function listEvents(opts: ClientOpts): Promise<MmEvent[]> {
  const all: MmEvent[] = [];
  let page = 1;
  while (true) {
    const r = await fetchWithRetry(
      `${opts.base}/flow/custom-events?page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/json",
        },
      }
    );
    if (!r.ok) {
      throw new Error(`listEvents failed: HTTP ${r.status} on page ${page}`);
    }
    const j = (await r.json()) as PaginatedResponse<MmEvent>;
    all.push(...j.data);
    if (j.meta.current_page >= j.meta.last_page) break;
    page++;
    // Hard safety net against infinite loops if API misbehaves.
    if (page > 200) {
      throw new Error("listEvents: pagination > 200 pages, aborting");
    }
  }
  return all;
}

/**
 * Iterates occurrences of an event using the API's ascending-id cursor.
 *
 * Contract of GET /flow/custom-events/data (vérifié en live 2026-06-02, cf.
 * brain/LEARNINGS.md) :
 *   - les lignes sont renvoyées par id CROISSANT ;
 *   - `start_id` est un curseur EXCLUSIF (renvoie les lignes d'id > start_id),
 *     donc on passe le watermark TEL QUEL (pas +1) ;
 *   - `limit` est la taille de page, plafond DUR 100 (>100 → HTTP 422) ;
 *   - `meta.total` est un compte total fiable (diagnostic seulement, JAMAIS
 *     utilisé pour avancer le curseur).
 *
 * On part de `startId` (le watermark de sync) et on avance jusqu'à une page qui
 * renvoie moins de `limit` lignes (dernière page). AUCUN break précoce sur l'id :
 * l'ancienne logique page-based + ordre descendant gelait chaque event après le
 * backfill initial (bug documenté LEARNINGS 2026-06-02).
 */
export async function* iterOccurrences(
  opts: ClientOpts,
  eventNs: string,
  startId = 0
): AsyncGenerator<MmOccurrence[], void, void> {
  const limit = 100;
  let cursor = startId;
  let pages = 0;
  while (true) {
    const url = `${opts.base}/flow/custom-events/data?event_ns=${encodeURIComponent(
      eventNs
    )}&start_id=${cursor}&limit=${limit}`;
    const r = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      throw new Error(
        `iterOccurrences failed: HTTP ${r.status} on event ${eventNs} start_id ${cursor}`
      );
    }
    const j = (await r.json()) as PaginatedResponse<MmOccurrence>;
    const rows = j.data ?? [];
    if (rows.length === 0) break;
    yield rows;
    // Curseur = max id de la page (ordre croissant). On exige une progression
    // stricte pour ne jamais boucler à l'infini si l'API renvoie en boucle.
    let maxId = cursor;
    for (const o of rows) if (o.id > maxId) maxId = o.id;
    if (maxId <= cursor) break;
    cursor = maxId;
    if (rows.length < limit) break; // dernière page
    if (++pages > 100_000) {
      throw new Error(
        `iterOccurrences: pagination > 100000 pages on ${eventNs}, aborting`
      );
    }
  }
}
