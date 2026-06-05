// Client API MessagingMe — envoi direct de messages WhatsApp (Pattern B).
// Bot assurance : réponses TEXTE (le RAG renvoie des réponses rédigées, pas des
// cartes), + escalade optionnelle vers un conseiller humain (node éditeur).
import { env } from "./db.mjs";

const BASE = env.MM_API_BASE || "https://ai.messagingme.app/api";
const TOKEN = env.MM_API_TOKEN;

// Node "parler à un conseiller" (optionnel) : déclenché par l'outil d'escalade.
const HELP_NODE = env.MM_HELP_NODE_NS || null;
// User field (par namespace) où écrire le résumé de la conversation pour le
// conseiller, juste avant de déclencher le node de transfert.
const SUMMARY_FIELD = env.MM_SUMMARY_FIELD_NS || null;
// Subflow "agent IA interne UChat" — escape hatch quand le budget API est saturé.
// No-op tant que MM_OVERFLOW_NODE_NS n'est pas défini.
const OVERFLOW_NODE = env.MM_OVERFLOW_NODE_NS || null;

export const mmEnabled = Boolean(TOKEN);
export const helpNodeEnabled = Boolean(HELP_NODE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Débit MM : piloté par le quota RÉEL renvoyé par UChat ──────────────────
// UChat plafonne à 1000 req/h/token (plafond DUR) et renvoie le budget restant
// dans les headers de CHAQUE réponse. On lit cette source de vérité plutôt que
// de tenir un compteur local (qui dérive et ne survit pas à un restart).
const MM_SOFT_START = Number(env.MM_SOFT_START || 0.7);
const MM_HANDOFF_THRESHOLD = Number(env.MM_HANDOFF_THRESHOLD || 0.95);
const MM_429_RETRIES = Number(env.MM_429_RETRIES || 5);
const MM_429_MAX_WAIT_MS = Number(env.MM_429_MAX_WAIT_MS || 30_000);

let mmLimit = Number(env.MM_HOURLY_LIMIT || 1000);
let mmRemaining = mmLimit;
let mmInFlight = 0;
let mmTenseLogged = 0;

function readRateLimit(res) {
  if (!res || !res.headers) return;
  const lim = Number(res.headers.get("x-ratelimit-limit"));
  const rem = Number(res.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(lim) && lim > 0) mmLimit = lim;
  if (Number.isFinite(rem)) mmRemaining = rem;
}

function mmRemainingEff() {
  return mmRemaining - mmInFlight;
}
function mmTension() {
  return mmLimit > 0 ? 1 - mmRemainingEff() / mmLimit : 0;
}

// Sonde de boot : connaître le budget réel dès le démarrage (robustesse au
// restart en pleine charge).
export async function mmWarmup() {
  if (!TOKEN) return;
  try {
    const res = await fetch(BASE + "/subscriber/set-user-fields-by-name", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ user_ns: "warmup", data: [] }),
      signal: AbortSignal.timeout(10000),
    });
    readRateLimit(res);
    console.log(`[mm-débit] budget au boot : ${mmRemaining}/${mmLimit} restant`);
  } catch (e) {
    console.error("[mm-débit] sonde quota au boot échouée :", e.message);
  }
}

// Escape hatch : au-delà du seuil, on transfère le contact vers le subflow
// "agent IA interne UChat" puis on le lâche. No-op tant que le node n'est pas défini.
const handedOff = new Set();
export async function maybeHandoff(userNs) {
  if (!OVERFLOW_NODE || handedOff.has(userNs)) return false;
  if (mmTension() < MM_HANDOFF_THRESHOLD) return false;
  const res = await mmRequest("POST", "/subscriber/send-node", {
    user_ns: userNs,
    node_ns: OVERFLOW_NODE,
  });
  const ok = checkResult(res).ok;
  if (ok) handedOff.add(userNs);
  console.log(
    `[mm-handoff] ${userNs} -> agent interne (budget ${Math.round(mmTension() * 100)}%) ${ok ? "ok" : "ÉCHEC"}`
  );
  return ok;
}

async function acquireMmSlot() {
  let waited = 0;
  while (mmRemainingEff() <= 0) {
    console.log(`[mm-débit] budget épuisé (restant=${mmRemaining}, en vol=${mmInFlight}) -> pause 2s`);
    await sleep(2000);
    if ((waited += 2000) >= 120_000) break;
  }
  mmInFlight++;
  const r = mmTension();
  if (r > MM_SOFT_START) {
    const t = (r - MM_SOFT_START) / (1 - MM_SOFT_START);
    const delay = Math.round(t * t * (3_600_000 / mmLimit));
    const now = Date.now();
    if (now - mmTenseLogged > 30_000) {
      console.log(`[mm-débit] zone tendue ${Math.round(r * 100)}% (restant ${mmRemainingEff()}/${mmLimit}) -> +${delay}ms/envoi`);
      mmTenseLogged = now;
    }
    if (delay > 0) await sleep(delay);
  }
}

async function mmRequest(method, path, body, attempt = 0) {
  await acquireMmSlot();
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } finally {
    mmInFlight = Math.max(0, mmInFlight - 1);
  }
  readRateLimit(res);
  if (res.status === 429 && attempt < MM_429_RETRIES) {
    const ra = Number(res.headers.get("retry-after"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    let waitMs =
      Number.isFinite(ra) && ra >= 0
        ? ra * 1000
        : Number.isFinite(reset)
        ? Math.max(0, reset * 1000 - Date.now())
        : 1000 * 2 ** attempt;
    if (waitMs > MM_429_MAX_WAIT_MS) {
      console.log(`[mm] 429 sur ${path} : reset loin (~${Math.ceil(waitMs / 1000)}s) -> abandon`);
    } else {
      console.log(`[mm] 429 sur ${path} -> attente ${Math.ceil(waitMs / 1000)}s puis retry`);
      await sleep(waitMs);
      return mmRequest(method, path, body, attempt + 1);
    }
  }
  return res.json().catch(() => ({}));
}

// Succès = status "ok" explicite. Toute autre réponse (erreur, 405, HTML…) = échec.
function checkResult(r) {
  if (r && r.status === "ok") return { ok: true };
  return {
    ok: false,
    error: r?.message || r?.error || JSON.stringify(r?.errors ?? r ?? {}),
  };
}

/** Envoie un message texte (POST /subscriber/send-text). */
export async function sendText(userNs, content) {
  if (!TOKEN) return { ok: false, error: "MM_API_TOKEN absent" };
  try {
    return checkResult(
      await mmRequest("POST", "/subscriber/send-text", { user_ns: userNs, content })
    );
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

/**
 * Escalade vers un conseiller humain. Si un résumé est fourni, on l'écrit
 * d'abord dans le user field (par namespace) destiné au conseiller, puis on
 * déclenche le node de transfert (qui envoie le message de confirmation).
 */
export async function sendHelpCard(userNs, summary = null) {
  if (!HELP_NODE) return { ok: false, error: "MM_HELP_NODE_NS absent" };
  try {
    if (summary && SUMMARY_FIELD) {
      const set = await mmRequest("PUT", "/subscriber/set-user-field", {
        user_ns: userNs,
        var_ns: SUMMARY_FIELD,
        value: summary,
      });
      const sc = checkResult(set);
      if (!sc.ok) console.error("[escalade] écriture résumé échec :", sc.error);
      await sleep(1500); // laisse le champ se propager avant le node
    }
    return checkResult(
      await mmRequest("POST", "/subscriber/send-node", {
        user_ns: userNs,
        node_ns: HELP_NODE,
      })
    );
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

/**
 * Envoie la liste des messages sortants de l'agent, dans l'ordre.
 * Types gérés : { type: "text", text } et { type: "help" } (escalade conseiller).
 * WhatsApp affiche dans l'ordre d'arrivée -> petit délai entre 2 messages.
 */
export async function sendOutbound(userNs, outbound) {
  const results = [];
  let first = true;
  for (const m of outbound) {
    if (!first) await sleep(1200);
    first = false;
    if (m.type === "help") {
      const r = HELP_NODE
        ? await sendHelpCard(userNs, m.summary)
        : await sendText(userNs, m.text || "Je transmets votre demande à un conseiller Gan Prévoyance.");
      results.push(r);
    } else {
      results.push(await sendText(userNs, m.text));
    }
  }
  return results;
}
