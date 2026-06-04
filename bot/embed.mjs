// Vectorise les chunks de kb_chunks dont l'embedding est null (e5-base, 768-dim).
// Idempotent : relançable, ne retouche que les nouveaux chunks.
import { withDb, closePool } from "./db.mjs";
import { embed, toPgVector, shutdownEmbedder } from "./embedder.mjs";

async function main() {
  const { rows } = await withDb((c) =>
    c.query("select id, title, content from kb_chunks where embedding is null order by created_at")
  );
  console.log(`${rows.length} chunks à vectoriser…`);

  let done = 0;
  for (const r of rows) {
    const text = [r.title, r.content].filter(Boolean).join("\n");
    const vec = toPgVector(await embed(text, "passage"));
    await withDb((c) => c.query("update kb_chunks set embedding = $1 where id = $2", [vec, r.id]));
    if (++done % 25 === 0) console.log(`  ${done}/${rows.length}`);
  }

  console.log(`Terminé : ${done} chunks vectorisés.`);
  await shutdownEmbedder();
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
