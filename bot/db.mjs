// Helper de connexion Postgres (Supabase Gan Prévoyance) avec pool partagé.
import { readFileSync } from "node:fs";
import pg from "pg";

export const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const REF = env.SUPABASE_PROJECT_REF;

// Par défaut : connexion directe `db.<ref>.supabase.co` (IPv6 sur les nouveaux
// projets Supabase). Si SUPABASE_DB_HOST est défini (pooler IPv4
// `aws-0-<region>.pooler.supabase.com` + user `postgres.<ref>`), on l'utilise.
// `setup-db.mjs` sonde les hôtes et affiche celui qui passe, à coller dans .env
// si le direct ne marche pas depuis la machine (cas IPv4-only).
const config = {
  host: env.SUPABASE_DB_HOST || `db.${REF}.supabase.co`,
  port: Number(env.SUPABASE_DB_PORT || 5432),
  user: env.SUPABASE_DB_USER || "postgres",
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
};

// Pool partagé. Les emprunts sont COURTS (aucune connexion tenue pendant les
// appels LLM, cf. agent.mjs), donc on peut viser large. connectionTimeoutMillis
// élevé = sous contention on ATTEND qu'une connexion se libère (la file FIFO de
// pg.Pool) plutôt que d'erreurer — on préfère prendre du temps qu'un échec.
export const pool = new pg.Pool({
  ...config,
  max: Number(env.DB_POOL_MAX || 40),
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(env.DB_CONN_TIMEOUT_MS || 30_000),
});

pool.on("error", (e) => {
  // Une connexion idle a planté : pg recyclera, on log et on continue.
  console.error("pg pool error:", e.message);
});

/**
 * Emprunte un client du pool, exécute fn(client), relâche le client.
 * Pour les scripts one-shot (scrape, embed…) qui ne reposent pas sur le pool,
 * on peut aussi utiliser newClient().
 */
export async function withDb(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Client autonome (hors pool) — pour les scripts qui veulent contrôler la
// connexion eux-mêmes (transactions longues, setup, dump…).
export function newClient() {
  return new pg.Client(config);
}

// Permet aux scripts CLI de couper proprement le pool en sortie.
export async function closePool() {
  await pool.end();
}
