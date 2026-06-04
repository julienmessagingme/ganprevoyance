// Scrape ganprevoyance.fr -> table kb_chunks (FAQ + pages produits/garanties).
// Stratégie : sitemap.xml si dispo, sinon crawl BFS borné depuis l'accueil.
// Chaque page : extraction du texte principal (cheerio), découpage en chunks,
// upsert idempotent sur (url, chunk_index). La vectorisation se fait après via
// `npm run embed`.
import * as cheerio from "cheerio";
import { withDb, closePool } from "./db.mjs";

const BASE = process.env.SCRAPE_BASE || "https://www.ganprevoyance.fr";
const ORIGIN = new URL(BASE).origin;
const MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES || 400);
const CHUNK_CHARS = Number(process.env.SCRAPE_CHUNK_CHARS || 900);
// ganprevoyance.fr ne sert le contenu SSR qu'à un vrai UA navigateur (anti-bot).
// Un UA générique renvoie une coquille vide -> on se présente comme Chrome.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Récupère les URLs depuis le(s) sitemap(s). Gère les sitemap index.
async function urlsFromSitemaps() {
  const found = new Set();
  const queue = [`${ORIGIN}/sitemap.xml`, `${ORIGIN}/sitemap_index.xml`];
  const seen = new Set();
  while (queue.length) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml;
    try {
      xml = await fetchText(sm);
    } catch {
      continue;
    }
    const $ = cheerio.load(xml, { xmlMode: true });
    // sitemap index -> sous-sitemaps
    $("sitemap > loc").each((_, el) => queue.push($(el).text().trim()));
    // urls
    $("url > loc").each((_, el) => {
      const u = $(el).text().trim();
      if (u && u.startsWith(ORIGIN)) found.add(u.split("#")[0]);
    });
  }
  return [...found];
}

// Crawl de secours si pas de sitemap : BFS borné, même domaine.
async function crawl() {
  const found = new Set();
  const queue = [BASE];
  const seen = new Set();
  while (queue.length && found.size < MAX_PAGES) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    let html;
    try {
      html = await fetchText(u);
    } catch {
      continue;
    }
    found.add(u);
    const $ = cheerio.load(html);
    $("a[href]").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      try {
        const abs = new URL(href, u).toString().split("#")[0];
        if (abs.startsWith(ORIGIN) && !seen.has(abs) && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?)$/i.test(abs))
          queue.push(abs);
      } catch {}
    });
    await sleep(150);
  }
  return [...found];
}

// Extrait titre + texte principal d'une page. Supprime nav/footer/scripts.
function extract(html) {
  const $ = cheerio.load(html);
  // ⚠️ NE PAS retirer <form> : ganprevoyance.fr est en ASP.NET WebForms, toute la
  // page est dans un unique <form runat="server"> -> le retirer vide la page.
  $("script, style, noscript, nav, header, footer, svg, iframe, .cookie, #cookie, [role=navigation]").remove();
  const title = ($("h1").first().text() || $("title").text() || "").replace(/\s+/g, " ").trim();
  // Conteneur principal probable, sinon body.
  const main = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  // Paragraphes + titres + items de liste, dans l'ordre.
  const parts = [];
  main.find("h1, h2, h3, h4, p, li").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length > 2) parts.push(t);
  });
  return { title, text: parts.join("\n") };
}

// Découpe le texte en chunks d'environ CHUNK_CHARS, aux frontières de lignes.
function chunkText(text) {
  const lines = text.split("\n");
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
  return chunks.filter((c) => c.length > 40);
}

function classify(url, title) {
  const s = (url + " " + (title || "")).toLowerCase();
  return /faq|question|aide/.test(s) ? "faq" : "page";
}

async function main() {
  console.log(`Scrape ${BASE} …`);
  let urls = await urlsFromSitemaps();
  if (urls.length === 0) {
    console.log("Pas de sitemap exploitable -> crawl BFS.");
    urls = await crawl();
  }
  urls = urls.slice(0, MAX_PAGES);
  console.log(`${urls.length} pages à traiter.`);

  const now = new Date().toISOString();
  let pages = 0;
  let totalChunks = 0;

  for (const url of urls) {
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.log(`  skip ${url} (${e.message})`);
      continue;
    }
    const { title, text } = extract(html);
    const chunks = chunkText(text);
    if (chunks.length === 0) continue;
    const kind = classify(url, title);

    await withDb(async (c) => {
      // Remplace les chunks de cette page (réimport propre).
      await c.query("delete from kb_chunks where url = $1", [url]);
      for (let i = 0; i < chunks.length; i++) {
        await c.query(
          `insert into kb_chunks (url, title, section, kind, chunk_index, content, scraped_at)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (url, chunk_index) do update
             set title = excluded.title, section = excluded.section, kind = excluded.kind,
                 content = excluded.content, scraped_at = excluded.scraped_at, embedding = null`,
          [url, title, null, kind, i, chunks[i], now]
        );
      }
    });

    pages++;
    totalChunks += chunks.length;
    if (pages % 20 === 0) console.log(`  ${pages}/${urls.length} pages, ${totalChunks} chunks`);
    await sleep(150);
  }

  console.log(`\nTerminé : ${pages} pages, ${totalChunks} chunks insérés.`);
  console.log("Lance maintenant `npm run embed` pour vectoriser.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
