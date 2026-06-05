// Serveur webhook Gan Prévoyance — reçoit les messages WhatsApp relayés par
// MessagingMe, ACK immédiatement (200) puis traite en tâche de fond (agent +
// envois). Le flow MessagingMe ignore la réponse → pas besoin d'attendre la fin
// du traitement pour libérer la requête HTTP (concurrence plus saine sous charge).
//
// Body attendu : { "external_id": "<user_ns>", "message": "<texte>" }
import http from "node:http";
import { handleMessage } from "./agent.mjs";
import { sendOutbound, sendText, mmEnabled, maybeHandoff, mmWarmup } from "./mmclient.mjs";
import { env } from "./db.mjs";
import { warmupEmbedder } from "./embedder.mjs";
import { upsertKbSource, deleteKbSource } from "./kb-ingest.mjs";

// Retire les accolades parasites éventuelles autour des valeurs du flow.
const clean = (s) => String(s ?? "").trim().replace(/^\{+|\}+$/g, "").trim();

// Gate de concurrence : on ne traite que MAX_CONCURRENCY conversations à la fois ;
// le surplus ATTEND en file (le webhook a déjà ACK). Protège pool DB + embedder
// mono-worker + débit Gemini/MM d'un seul coup.
function createGate(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  };
  const run = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  run.stats = () => ({ active, queued: queue.length });
  return run;
}
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || env.MAX_CONCURRENCY || 15);
const gate = createGate(MAX_CONCURRENCY);

// Délai croissant pour les conversations LONGUES : plus un contact a échangé de
// tours, plus on temporise. Étale les gros consommateurs (budget MM + tokens).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG_CONVO_START = Number(env.LONG_CONVO_START || 10);
const LONG_CONVO_STEP_MS = Number(env.LONG_CONVO_STEP_MS || 700);
const LONG_CONVO_MAX_MS = Number(env.LONG_CONVO_MAX_MS || 12_000);
function longConvoDelay(turns) {
  if (!turns || turns <= LONG_CONVO_START) return 0;
  return Math.min(LONG_CONVO_MAX_MS, (turns - LONG_CONVO_START) * LONG_CONVO_STEP_MS);
}

const PORT = process.env.PORT || env.PORT || 8130;
// HOST : sur VPS, binder sur la gateway Docker mcp-robot_default (172.18.0.1) pour
// que NPM atteigne le service sans l'exposer sur l'IP publique. Défaut "0.0.0.0".
const HOST = process.env.HOST || env.HOST || "0.0.0.0";
const SECRET = env.WEBHOOK_SECRET;
const NO_SEND = env.NO_SEND === "1";

if (!SECRET) {
  console.error("WEBHOOK_SECRET absent de .env — démarrage refusé.");
  process.exit(1);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("body trop volumineux"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function processInBackground(externalId, message) {
  const t0 = Date.now();
  try {
    const { active, queued } = gate.stats();
    if (queued > 0)
      console.log(`[gate] ${externalId} en file (actifs=${active}, en attente=${queued})`);
    const { outbound, turns } = await gate(() => handleMessage(externalId, message));
    const convoDelay = longConvoDelay(turns);
    if (convoDelay > 0) {
      console.log(`[long-convo] ${externalId} tour ${turns} -> +${convoDelay}ms avant réponse`);
      await sleep(convoDelay);
    }
    const apercu = outbound.map((m) => m.type).join("+") || "vide";
    let sent = "désactivé";
    if (mmEnabled && !NO_SEND) {
      const results = await sendOutbound(externalId, outbound);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok);
      sent = fail.length ? `${ok} ok / ${fail.length} échec (${fail[0].error})` : `${ok} ok`;
      if (await maybeHandoff(externalId)) sent += " +handoff";
    } else if (NO_SEND) {
      sent = "no-send";
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[${new Date().toISOString()}] ${externalId} :: "${message}" -> [${apercu}] | envoi: ${sent} | ${dt}s`);
  } catch (e) {
    console.error(`[bg] ${externalId} :: "${message}" -> ÉCHEC :`, e.message);
    if (mmEnabled && !NO_SEND) {
      try {
        await sendText(externalId, "Désolé, j'ai eu un souci technique. Pouvez-vous reformuler ?");
      } catch {}
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health")
    return send(res, 200, { ok: true });

  // API base de connaissance (appelée par l'onglet du dashboard). Synchrone :
  // l'appelant attend le résultat. Auth par le même secret que le webhook.
  if (req.method === "POST" && (req.url === "/kb/upsert" || req.url === "/kb/delete")) {
    if (req.headers["x-webhook-secret"] !== SECRET)
      return send(res, 401, { error: "unauthorized" });
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "JSON invalide" });
    }
    try {
      if (req.url === "/kb/upsert") {
        if (!body.sourceId || !String(body.content || "").trim())
          return send(res, 400, { error: "sourceId et content requis" });
        const r = await upsertKbSource(body);
        return send(res, 200, { ok: true, ...r });
      }
      if (!body.sourceId) return send(res, 400, { error: "sourceId requis" });
      const r = await deleteKbSource(body.sourceId);
      return send(res, 200, { ok: true, ...r });
    } catch (e) {
      console.error("[kb-api]", req.url, e.message);
      return send(res, 500, { error: String(e.message) });
    }
  }

  if (req.method !== "POST" || !req.url.startsWith("/webhook"))
    return send(res, 404, { error: "not found" });

  if (req.headers["x-webhook-secret"] !== SECRET)
    return send(res, 401, { error: "unauthorized" });

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { error: "JSON invalide" });
  }
  const externalId = clean(body.external_id || body.subscriber_id || body.user_id);
  const message = clean(body.message || body.text || body.last_input);
  if (!externalId || !message)
    return send(res, 400, { error: "external_id et message requis" });

  // ACK immédiat : MessagingMe ne bloque pas sur notre traitement.
  send(res, 200, { ok: true });

  // Traitement asynchrone — pas d'await ici.
  processInBackground(externalId, message);
});

server.listen(PORT, HOST, () => {
  console.log(`Serveur Gan Prévoyance à l'écoute sur ${HOST}:${PORT}${NO_SEND ? " (NO_SEND)" : ""}`);
  warmupEmbedder()
    .then(() => console.log("Embedder chaud."))
    .catch((e) => console.error("Échec warmup embedder :", e.message));
  if (mmEnabled && !NO_SEND) mmWarmup();
});
