// Pousse le contenu de l'onglet "Base de connaissance" vers la KB du bot
// (pgvector, projet Supabase dédié), via l'API d'ingestion du bot
// (server.mjs /kb/upsert et /kb/delete). C'est ce qui fait que ce que Julien
// ajoute dans l'onglet alimente VRAIMENT les réponses du bot WhatsApp.
//
// Best-effort : si le bot est indisponible, on log et on n'échoue PAS l'action
// côté dashboard (l'item reste en DB ; une ré-édition le re-poussera).
//
// Env : BOT_KB_URL (ex. http://172.18.0.1:8130) + BOT_KB_SECRET (= WEBHOOK_SECRET du bot).

const BOT_KB_URL = process.env.BOT_KB_URL;
const BOT_KB_SECRET = process.env.BOT_KB_SECRET;

export function botKbEnabled(): boolean {
  return Boolean(BOT_KB_URL && BOT_KB_SECRET);
}

export async function pushKbItem(
  sourceId: string,
  opts: { title?: string | null; kind?: string; content: string }
): Promise<boolean> {
  if (!botKbEnabled()) return false;
  if (!opts.content || !opts.content.trim()) return false;
  try {
    const r = await fetch(`${BOT_KB_URL}/kb/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": BOT_KB_SECRET as string },
      body: JSON.stringify({
        sourceId,
        title: opts.title ?? null,
        kind: opts.kind ?? "kb",
        content: opts.content,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      console.warn(`[bot-kb] upsert ${sourceId} HTTP ${r.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[bot-kb] upsert ${sourceId} échec :`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function deleteKbItem(sourceId: string): Promise<boolean> {
  if (!botKbEnabled()) return false;
  try {
    const r = await fetch(`${BOT_KB_URL}/kb/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": BOT_KB_SECRET as string },
      body: JSON.stringify({ sourceId }),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch (e) {
    console.warn(`[bot-kb] delete ${sourceId} échec :`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Construit le texte d'une Q&R pour la KB du bot.
export function qaContent(question: string, answer: string): string {
  return `Question : ${question}\nRéponse : ${answer}`;
}
