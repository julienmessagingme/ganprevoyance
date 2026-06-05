// Ingestion programmatique dans la base de connaissance du bot (kb_chunks).
// Utilisé par l'API HTTP du serveur (/kb/upsert, /kb/delete), appelée par
// l'onglet "Base de connaissance" du dashboard. Découpe + embed e5 + upsert.
import { withDb } from "./db.mjs";
import { embed, toPgVector } from "./embedder.mjs";

const CHUNK_CHARS = Number(process.env.KB_CHUNK_CHARS || 900);

// URL stable dérivée de l'id de la source côté dashboard (pour pouvoir remplacer
// / supprimer proprement une entrée éditée dans l'onglet).
export function sourceUrl(sourceId) {
  return "kb://" + String(sourceId);
}

function chunkText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const line of lines) {
    if ((buf + "\n" + line).length > CHUNK_CHARS && buf) {
      chunks.push(buf.trim());
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.length > 10);
}

/**
 * Upsert d'une source de connaissance (1 entrée du dashboard) dans kb_chunks.
 * Remplace tous les chunks de cette source, ré-embed, écrit.
 * @returns {Promise<{chunks:number}>}
 */
export async function upsertKbSource({ sourceId, title = null, kind = "manual", content = "" }) {
  if (!sourceId) throw new Error("sourceId requis");
  const url = sourceUrl(sourceId);
  const chunks = chunkText(content);

  // Embed hors connexion DB (l'embedder est un worker ; pas de connexion tenue).
  const vectors = [];
  for (const c of chunks) {
    vectors.push(toPgVector(await embed([title, c].filter(Boolean).join("\n"), "passage")));
  }

  const now = new Date().toISOString();
  await withDb(async (client) => {
    await client.query("delete from kb_chunks where url = $1", [url]);
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `insert into kb_chunks (url, title, section, kind, chunk_index, content, embedding, scraped_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [url, title, null, kind, i, chunks[i], vectors[i], now]
      );
    }
  });
  return { chunks: chunks.length };
}

/** Supprime tous les chunks d'une source (entrée supprimée dans le dashboard). */
export async function deleteKbSource(sourceId) {
  if (!sourceId) throw new Error("sourceId requis");
  const url = sourceUrl(sourceId);
  const r = await withDb((client) => client.query("delete from kb_chunks where url = $1", [url]));
  return { deleted: r.rowCount };
}
