// Recherche HYBRIDE dans la base de connaissance Gan Prévoyance : sémantique
// (pgvector e5-base) + correspondance mots-clés (ILIKE). Les embeddings seuls ne
// discriminent pas bien les questions factuelles courtes ("numéro du service
// client") dans un grand corpus (similarités tassées) ; la couche mots-clés
// garantit de remonter le chunk qui contient littéralement les termes demandés.
import { withDb, closePool } from "./db.mjs";
import { embed, toPgVector, shutdownEmbedder } from "./embedder.mjs";

// Mots vides FR + mots-questions (n'apportent rien en recherche mot-clé).
const STOP = new Set(
  ("le la les un une des de du au aux et ou est sont avec sans dans pour par sur " +
    "vous nous mon ma mes votre vos notre nos ce cet cette ces que qui quoi dont où " +
    "comment quel quelle quels quelles combien pourquoi quand puis peut peux faire " +
    "avoir être je tu il elle on ils elles ne pas plus moins très bien chez vos")
    .split(/\s+/)
);

function keywords(q) {
  return Array.from(
    new Set(
      String(q)
        .toLowerCase()
        .split(/[^0-9a-zà-ÿ]+/)
        .filter((w) => w.length >= 4 && !STOP.has(w))
    )
  ).slice(0, 8);
}

/**
 * @param {object} opts
 * @param {string}  opts.texteLibre  question du client (reformulée)
 * @param {number} [opts.limit]      nb de passages sémantiques (def. 5)
 */
export async function searchKb({ texteLibre = "", limit = 5, traceId = null } = {}) {
  if (!texteLibre.trim()) return [];

  const vec = toPgVector(await embed(texteLibre, "query"));
  const words = keywords(texteLibre);

  const { vecRows, kwRows } = await withDb(async (c) => {
    const vr = (
      await c.query(
        `select url, title, section, kind, content, 1 - (embedding <=> $1) as similarity
         from kb_chunks where embedding is not null
         order by embedding <=> $1 limit $2`,
        [vec, limit]
      )
    ).rows;

    let kr = [];
    if (words.length) {
      const likeParams = words.map((w) => `%${w}%`);
      const hitsExpr = words.map((_, i) => `(content ilike $${i + 1})::int`).join(" + ");
      const orExpr = words.map((_, i) => `content ilike $${i + 1}`).join(" or ");
      kr = (
        await c.query(
          `select url, title, section, kind, content, (${hitsExpr}) as hits
           from kb_chunks
           where ${orExpr}
           order by hits desc, char_length(content) asc
           limit 4`,
          likeParams
        )
      ).rows;
    }
    return { vecRows: vr, kwRows: kr };
  });

  // Fusion : on met en tête les chunks qui matchent FORTEMENT les mots-clés
  // (≥ 2 termes = la réponse factuelle demandée), puis le sémantique, puis les
  // matches mots-clés simples. Déduplication par (url + début de contenu).
  const out = [];
  const seen = new Set();
  const push = (r, sim) => {
    const k = r.url + "#" + String(r.content || "").slice(0, 40);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({
      url: r.url,
      title: r.title,
      section: r.section,
      kind: r.kind,
      content: r.content,
      similarity: sim != null ? +(+sim).toFixed(3) : null,
    });
  };
  for (const r of kwRows) if (r.hits >= 2) push(r, null);
  for (const r of vecRows) push(r, r.similarity);
  for (const r of kwRows) if (r.hits >= 1) push(r, null);

  const final = out.slice(0, Math.max(limit, 6));
  if (traceId)
    console.log(`[kb-timing] ${traceId} kw=${kwRows.length} vec=${vecRows.length} -> ${final.length}`);
  return final;
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
