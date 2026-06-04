// Recherche sémantique dans la base de connaissance Gan Prévoyance (FAQ + pages
// produits/garanties scrapées). C'est l'outil que l'agent appelle pour fonder
// ses réponses (RAG). Similarité cosinus pgvector sur embeddings e5-base.
import { withDb, closePool } from "./db.mjs";
import { embed, toPgVector, shutdownEmbedder } from "./embedder.mjs";

/**
 * @param {object} opts
 * @param {string}  opts.texteLibre  question du client (reformulée)
 * @param {number} [opts.limit]      nb de passages à renvoyer (def. 5)
 */
export async function searchKb({ texteLibre = "", limit = 5, traceId = null } = {}) {
  if (!texteLibre.trim()) return [];

  const t = Date.now();
  const vec = toPgVector(await embed(texteLibre, "query"));
  const embedMs = Date.now() - t;

  const tDb = Date.now();
  const rows = await withDb(async (c) =>
    (
      await c.query(
        `select url, title, section, kind, content,
                1 - (embedding <=> $1) as similarity
         from kb_chunks
         where embedding is not null
         order by embedding <=> $1
         limit $2`,
        [vec, limit]
      )
    ).rows
  );
  const dbMs = Date.now() - tDb;

  if (traceId)
    console.log(`[kb-timing] ${traceId} embed=${embedMs}ms db=${dbMs}ms rows=${rows.length}`);

  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    section: r.section,
    kind: r.kind,
    content: r.content,
    similarity: r.similarity != null ? +(+r.similarity).toFixed(3) : null,
  }));
}

// Mode CLI : node search.mjs "ma question"
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const q = process.argv.slice(2).join(" ");
  const res = await searchKb({ texteLibre: q, limit: 6 });
  console.log(`\n${res.length} résultats :\n`);
  for (const r of res) {
    console.log(`  [${r.similarity ?? "—"}] ${r.title || r.url} (${r.kind})`);
    console.log(`    ${r.url}`);
    console.log(`    ${(r.content || "").slice(0, 140)}…\n`);
  }
  await shutdownEmbedder();
  await closePool();
}
