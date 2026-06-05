// Client de l'API base de connaissance du bot (server.mjs /kb/*). La KB du bot
// (table kb_chunks pgvector, projet Supabase dédié) est la source UNIQUE : le
// site scrapé, les documents et les entrées manuelles y vivent ensemble. L'onglet
// "Base de connaissance" du dashboard lit/écrit cette KB via cette couche.
//
// Env : BOT_KB_URL (ex. http://172.18.0.1:8130) + BOT_KB_SECRET (= WEBHOOK_SECRET du bot).

const BOT_KB_URL = process.env.BOT_KB_URL;
const BOT_KB_SECRET = process.env.BOT_KB_SECRET;

export function botKbEnabled(): boolean {
  return Boolean(BOT_KB_URL && BOT_KB_SECRET);
}

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Webhook-Secret": BOT_KB_SECRET as string,
  };
}

export interface KbSource {
  url: string;
  title: string | null;
  kind: string | null;
  chunks: number;
  sourceType: "site" | "document" | "manuel" | "autre";
  preview: string;
  updated: string | null;
}

export async function listKbSources(q = ""): Promise<KbSource[]> {
  if (!botKbEnabled()) return [];
  const url = `${BOT_KB_URL}/kb/list${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const r = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`bot /kb/list HTTP ${r.status}`);
  const j = await r.json();
  return (j.sources ?? []) as KbSource[];
}

export async function getKbSource(
  url: string
): Promise<{ url: string; title: string | null; kind: string | null; sourceType: string; content: string } | null> {
  if (!botKbEnabled()) return null;
  const r = await fetch(`${BOT_KB_URL}/kb/get?url=${encodeURIComponent(url)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`bot /kb/get HTTP ${r.status}`);
  return (await r.json()).source ?? null;
}

export async function upsertKbSource(p: {
  url?: string;
  sourceId?: string;
  title?: string | null;
  kind?: string;
  content: string;
}): Promise<{ chunks: number }> {
  if (!botKbEnabled()) throw new Error("BOT_KB non configuré (BOT_KB_URL / BOT_KB_SECRET)");
  const r = await fetch(`${BOT_KB_URL}/kb/upsert`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(p),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`bot /kb/upsert HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

export async function deleteKbSource(url: string): Promise<{ deleted: number }> {
  if (!botKbEnabled()) throw new Error("BOT_KB non configuré");
  const r = await fetch(`${BOT_KB_URL}/kb/delete`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`bot /kb/delete HTTP ${r.status}`);
  return await r.json();
}
