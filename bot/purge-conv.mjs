// Purge RGPD des conversations inactives. Les messages peuvent contenir des
// données personnelles / de santé → on ne les conserve pas au-delà de
// CONV_RETENTION_DAYS jours d'inactivité (défaut 30). Limitation de conservation.
//
// Appelée automatiquement par server.mjs (au boot + 1×/jour), et lançable à la
// main : `node purge-conv.mjs`.
import { env, withDb } from "./db.mjs";

export async function purgeOldConversations() {
  const days = Number(env.CONV_RETENTION_DAYS || 30);
  const r = await withDb((c) =>
    c.query(
      `delete from conversations where updated_at < now() - ($1 || ' days')::interval`,
      [String(days)]
    )
  );
  if (r.rowCount > 0) {
    console.log(`[purge] ${r.rowCount} conversation(s) inactive(s) > ${days}j supprimée(s).`);
  }
  return r.rowCount;
}

// Mode CLI.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { closePool } = await import("./db.mjs");
  const n = await purgeOldConversations();
  console.log(`Purge terminée : ${n} supprimée(s).`);
  await closePool();
  process.exit(0);
}
