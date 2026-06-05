// Scrape ganprevoyance.fr -> table kb_chunks (FAQ + pages produits/garanties).
// Stratégie : sitemap.xml si dispo, sinon crawl BFS borné depuis l'accueil.
// Nettoyage en 2 passes : (1) retrait nav/menu/footer/cookie par sélecteur, puis
// (2) filtre par FRÉQUENCE inter-pages (une ligne présente sur beaucoup de pages
// = boilerplate de gabarit -> supprimée). La vectorisation se fait via `npm run embed`.
import * as cheerio from "cheerio";
import { withDb, closePool } from "./db.mjs";

const BASE = process.env.SCRAPE_BASE || "https://www.ganprevoyance.fr";
const ORIGIN = new URL(BASE).origin;
const MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES || 400);
const CHUNK_CHARS = Number(process.env.SCRAPE_CHUNK_CHARS || 900);
// Seuil du filtre boilerplate : une ligne vue sur >= ce ratio de pages est virée.
const BOILER_RATIO = Number(process.env.SCRAPE_BOILER_RATIO || 0.2);
// ganprevoyance.fr ne sert le contenu SSR qu'à un vrai UA navigateur (anti-bot).
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Filet de sécurité : lignes de gabarit évidentes (en plus du filtre par fréquence).
const JUNK_LINE =
  /^(mentions légales|données personnelles|gérer mes cookies|cookies\b|réclamations|contactez-nous|nous contacter|plan du site|groupe groupama|une marque|suivez-nous|nous suivre|tous droits réservés|©|accueil|retour|partager|imprimer|haut de page)\b/i;

// CTA / nav de gabarit qui peuvent apparaître au milieu d'une ligne (non ancré).
const JUNK_CONTAINS =
  /(et si nous en parlions ensemble|je contacte un conseiller|me protéger, ma famille et moi|prendre rendez-vous|rappel gratuit|demander (un |une )?(devis|documentation|rappel)|souscrire en ligne|trouver une agence|nous appeler)/i;

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
    $("sitemap > loc").each((_, el) => queue.push($(el).text().trim()));
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
      const href = $(el).attr("href");
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

// Extrait titre + lignes de contenu. Retire nav/header/footer/menus/cookie.
// ⚠️ NE PAS retirer <form> : ASP.NET WebForms, toute la page est dans un <form>.
function extractLines(html) {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, nav, header, footer, svg, iframe, [role=navigation], " +
      "[class*=menu], [class*=Menu], [class*=cookie], [id*=cookie], " +
      "ul.list-inline, .list-inline, .breadcrumb, [class*=breadcrumb]"
  ).remove();
  const title = ($("h1").first().text() || $("title").text() || "").replace(/\s+/g, " ").trim();
  const main = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const lines = [];
  main.find("h1, h2, h3, h4, p, li").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length > 2) lines.push(t);
  });
  return { title, lines };
}

function chunkLines(lines) {
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
  console.log(`${urls.length} pages à récupérer.`);

  // ── Passe 1 : fetch + extraction des lignes ──────────────────────────────
  const docs = [];
  let fetched = 0;
  for (const url of urls) {
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      console.log(`  skip ${url} (${e.message})`);
      continue;
    }
    const { title, lines } = extractLines(html);
    docs.push({ url, title, lines });
    if (++fetched % 30 === 0) console.log(`  récupéré ${fetched}/${urls.length}`);
    await sleep(150);
  }

  // ── Détection du boilerplate : fréquence d'une ligne sur l'ensemble des pages ─
  const pageCount = new Map();
  for (const d of docs) {
    for (const ln of new Set(d.lines.map(norm))) pageCount.set(ln, (pageCount.get(ln) || 0) + 1);
  }
  const nbPages = docs.length || 1;
  const FREQ = Math.max(4, Math.ceil(BOILER_RATIO * nbPages));
  const isBoiler = (line) => {
    const n = norm(line);
    return JUNK_LINE.test(n) || JUNK_CONTAINS.test(n) || (pageCount.get(n) || 0) >= FREQ;
  };

  // ── Passe 2 : filtre boilerplate + chunk + upsert ────────────────────────
  const now = new Date().toISOString();
  let pages = 0;
  let totalChunks = 0;
  let droppedLines = 0;
  for (const d of docs) {
    const kept = [];
    for (const ln of d.lines) {
      if (isBoiler(ln)) {
        droppedLines++;
        continue;
      }
      kept.push(ln);
    }
    const chunks = chunkLines(kept);
    if (chunks.length === 0) continue;
    const kind = classify(d.url, d.title);

    await withDb(async (c) => {
      await c.query("delete from kb_chunks where url = $1", [d.url]);
      for (let i = 0; i < chunks.length; i++) {
        await c.query(
          `insert into kb_chunks (url, title, section, kind, chunk_index, content, scraped_at)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (url, chunk_index) do update
             set title = excluded.title, section = excluded.section, kind = excluded.kind,
                 content = excluded.content, scraped_at = excluded.scraped_at, embedding = null`,
          [d.url, d.title, null, kind, i, chunks[i], now]
        );
      }
    });

    pages++;
    totalChunks += chunks.length;
    if (pages % 20 === 0) console.log(`  ${pages}/${docs.length} pages, ${totalChunks} chunks`);
  }

  console.log(
    `\nTerminé : ${pages} pages, ${totalChunks} chunks (${droppedLines} lignes boilerplate retirées ; ` +
      `seuil = présent sur ≥ ${FREQ}/${nbPages} pages).`
  );
  console.log("Lance maintenant `npm run embed` pour vectoriser.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
