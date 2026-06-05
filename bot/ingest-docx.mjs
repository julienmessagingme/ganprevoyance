// Ingestion d'un document Word (.docx) dans la base de connaissance du bot.
// Usage : node ingest-docx.mjs "<chemin.docx>" ["Titre"] ["faq|page"]
// Puis : npm run embed  (pour vectoriser les nouveaux chunks).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import mammoth from "mammoth";
import { withDb, closePool } from "./db.mjs";

const CHUNK_CHARS = Number(process.env.CHUNK_CHARS || 900);

function slug(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Découpe le texte en chunks d'environ CHUNK_CHARS, aux frontières de lignes.
function chunkText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
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
  return chunks.filter((c) => c.length > 30);
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage : node ingest-docx.mjs "<chemin.docx>" ["Titre"] ["faq|page"]');
    process.exit(1);
  }
  const title = process.argv[3] || basename(path).replace(/\.docx$/i, "").trim();
  const kind = process.argv[4] || "faq";
  const url = "doc://" + slug(title);

  const buffer = readFileSync(path);
  const { value: text } = await mammoth.extractRawText({ buffer });
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    console.error("Aucun contenu extrait du document.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  await withDb(async (c) => {
    await c.query("delete from kb_chunks where url = $1", [url]);
    for (let i = 0; i < chunks.length; i++) {
      await c.query(
        `insert into kb_chunks (url, title, section, kind, chunk_index, content, scraped_at)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (url, chunk_index) do update
           set title = excluded.title, kind = excluded.kind, content = excluded.content,
               scraped_at = excluded.scraped_at, embedding = null`,
        [url, title, null, kind, i, chunks[i], now]
      );
    }
  });

  console.log(`Ingéré : "${title}" (${kind}) -> ${url}\n${chunks.length} chunks insérés.`);
  console.log("Lance maintenant `npm run embed` pour vectoriser.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
