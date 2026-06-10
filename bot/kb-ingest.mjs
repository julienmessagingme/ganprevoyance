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
export async function upsertKbSource({ sourceId, title = null, kind = "manuel", content = "" }) {
  if (!sourceId) throw new Error("sourceId requis");
  const url = sourceUrl(sourceId);
  const chunks = chunkText(content);

  // Embed hors connexion DB (l'embedder est un worker ; pas de connexion tenue).
  const vectors = [];
  for (const c of chunks) {
    vectors.push(toPgVector(await embed([title, c].filter(Boolean).join("\n"), "passage")));
  }

  const now = new Date().toISOString();
  await replaceChunks(url, title, kind, chunks, vectors, now);
  return { chunks: chunks.length };
}

/** Supprime tous les chunks d'une source (entrée supprimée dans le dashboard). */
export async function deleteKbSource(sourceId) {
  if (!sourceId) throw new Error("sourceId requis");
  const url = sourceUrl(sourceId);
  const r = await withDb((client) => client.query("delete from kb_chunks where url = $1", [url]));
  return { deleted: r.rowCount };
}

// Type de source lisible pour l'UI, déduit du préfixe de l'url.
function sourceType(url) {
  if (url.startsWith("kb://")) return "manuel";
  if (url.startsWith("doc://")) return "document";
  if (url.startsWith("http")) return "site";
  return "autre";
}

/**
 * Liste les sources de la KB (1 ligne par url) pour l'onglet du dashboard :
 * titre, type, nb de chunks, aperçu, date. Permet de voir tout le contenu
 * (site scrapé + documents + entrées manuelles) au même endroit.
 */
export async function listKbSources(q = "") {
  const term = String(q || "").trim();
  const rows = await withDb((client) => {
    if (term) {
      const like = `%${term}%`;
      // Recherche plein-texte (ILIKE) sur le CONTENU et le titre. On renvoie
      // toutes les sources dont au moins un chunk matche, et l'aperçu privilégie
      // le chunk qui matche (pour voir pourquoi ça ressort).
      return client.query(
        `select url,
                (array_agg(title order by chunk_index))[1] as title,
                (array_agg(kind  order by chunk_index))[1] as kind,
                count(*)::int as chunks,
                (array_agg(content order by (content ilike $1) desc, chunk_index))[1] as preview,
                max(coalesce(scraped_at, created_at)) as updated
         from kb_chunks
         where url in (select url from kb_chunks where content ilike $1 or title ilike $1)
         group by url
         order by max(coalesce(scraped_at, created_at)) desc nulls last`,
        [like]
      );
    }
    return client.query(
      `select url,
              (array_agg(title order by chunk_index))[1] as title,
              (array_agg(kind  order by chunk_index))[1] as kind,
              count(*)::int as chunks,
              (array_agg(content order by chunk_index))[1] as preview,
              max(coalesce(scraped_at, created_at)) as updated
       from kb_chunks
       group by url
       order by max(coalesce(scraped_at, created_at)) desc nulls last`
    );
  });
  return rows.rows.map((r) => ({
    url: r.url,
    title: r.title,
    kind: r.kind,
    chunks: r.chunks,
    sourceType: sourceType(r.url),
    preview: (r.preview || "").replace(/\s+/g, " ").slice(0, 180),
    updated: r.updated,
  }));
}

/** Contenu complet d'une source (chunks concaténés) pour l'édition dans l'onglet. */
export async function getKbSource(url) {
  if (!url) throw new Error("url requise");
  const rows = await withDb((client) =>
    client.query(
      "select title, kind, content from kb_chunks where url = $1 order by chunk_index",
      [url]
    )
  );
  if (rows.rows.length === 0) return null;
  return {
    url,
    title: rows.rows[0].title,
    kind: rows.rows[0].kind,
    sourceType: sourceType(url),
    content: rows.rows.map((r) => r.content).join("\n\n"),
  };
}

/** Upsert d'une source par URL directe (édition d'une source existante, ex. page scrapée). */
export async function upsertKbByUrl({ url, title = null, kind = "manuel", content = "" }) {
  if (!url) throw new Error("url requise");
  const chunks = chunkText(content);
  const vectors = [];
  for (const c of chunks) {
    vectors.push(toPgVector(await embed([title, c].filter(Boolean).join("\n"), "passage")));
  }
  const now = new Date().toISOString();
  await replaceChunks(url, title, kind, chunks, vectors, now);
  return { chunks: chunks.length };
}

// Remplace ATOMIQUEMENT tous les chunks d'une url : delete + insert dans UNE
// transaction. Sans ça, une erreur (ou une connexion pooler coupée) entre le
// delete et la fin des insert laisse la source vidée ou partielle = perte de KB.
async function replaceChunks(url, title, kind, chunks, vectors, now) {
  await withDb(async (client) => {
    try {
      await client.query("begin");
      await client.query("delete from kb_chunks where url = $1", [url]);
      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `insert into kb_chunks (url, title, section, kind, chunk_index, content, embedding, scraped_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [url, title, null, kind, i, chunks[i], vectors[i], now]
        );
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    }
  });
}

/** Supprime une source par URL directe. */
export async function deleteKbByUrl(url) {
  if (!url) throw new Error("url requise");
  const r = await withDb((client) => client.query("delete from kb_chunks where url = $1", [url]));
  return { deleted: r.rowCount };
}
