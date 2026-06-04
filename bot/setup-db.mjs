// Applique schema.sql sur le projet Supabase Gan Prévoyance.
// Sonde la connexion directe (IPv6) puis le pooler (IPv4) sur les régions EU.
// Affiche l'hôte qui marche : si ce n'est pas le direct, coller SUPABASE_DB_HOST
// / SUPABASE_DB_USER dans .env pour que le bot (db.mjs) l'utilise au runtime.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf-8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const REF = env.SUPABASE_PROJECT_REF;
const PWD = env.SUPABASE_DB_PASSWORD;
const sql = readFileSync(new URL("schema.sql", import.meta.url), "utf-8");

const targets = [
  { label: "direct (IPv6)", host: `db.${REF}.supabase.co`, port: 5432, user: "postgres" },
  ...["eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1"].flatMap(
    (region) =>
      ["aws-0", "aws-1"].map((prefix) => ({
        label: `pooler ${prefix}-${region}`,
        host: `${prefix}-${region}.pooler.supabase.com`,
        port: 5432,
        user: `postgres.${REF}`,
      }))
  ),
];

async function tryConnect(t) {
  const client = new pg.Client({
    host: t.host,
    port: t.port,
    user: t.user,
    password: PWD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

async function main() {
  let client = null;
  let used = null;
  for (const t of targets) {
    try {
      process.stdout.write(`Connexion ${t.label} (${t.host})… `);
      client = await tryConnect(t);
      used = t;
      console.log("OK");
      break;
    } catch (e) {
      console.log(`échec (${e.code || e.message})`);
    }
  }
  if (!client) {
    console.error("\nAucune connexion possible. Vérifier le mot de passe / la région.");
    process.exit(1);
  }

  if (used.label !== "direct (IPv6)") {
    console.log(
      `\n⚠️  Le direct ne passe pas depuis cette machine. Pour le runtime du bot,` +
        ` ajouter dans .env :\n   SUPABASE_DB_HOST=${used.host}\n   SUPABASE_DB_USER=${used.user}\n   SUPABASE_DB_PORT=${used.port}`
    );
  }

  console.log("\nApplication de schema.sql…");
  await client.query(sql);
  console.log("Schéma appliqué.");

  const t = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1"
  );
  console.log("Tables publiques :", t.rows.map((r) => r.table_name).join(", "));

  for (const tbl of ["kb_chunks", "conversations"]) {
    const c = await client.query(
      "select column_name, data_type from information_schema.columns where table_name=$1 order by ordinal_position",
      [tbl]
    );
    console.log(`\nColonnes de \`${tbl}\` :`);
    for (const r of c.rows) console.log(`  ${r.column_name.padEnd(18)} ${r.data_type}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
