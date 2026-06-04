// API d'embedding côté process principal — délègue à un worker thread pour
// ne pas bloquer la boucle d'événements (cf. embedder-worker.mjs).
// API : embed(text, kind) -> Promise<number[]>, identique à l'ancienne.
import { Worker } from "node:worker_threads";

export const EMBED_DIM = 768;

let _worker = null;
const _pending = new Map();
let _nextId = 1;

function getWorker() {
  if (_worker) return _worker;
  // execArgv: [] -> le worker n'hérite pas des flags du process parent (ex.
  // --input-type=module passé à un `node -e`, incompatible avec un worker fichier).
  _worker = new Worker(new URL("./embedder-worker.mjs", import.meta.url), { execArgv: [] });
  _worker.on("message", (msg) => {
    const p = _pending.get(msg.id);
    if (!p) return;
    _pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.vec);
  });
  _worker.on("error", (e) => {
    for (const p of _pending.values()) p.reject(e);
    _pending.clear();
    _worker = null;
  });
  _worker.on("exit", (code) => {
    if (code !== 0) console.error("[embedder] worker exit code:", code);
    for (const p of _pending.values()) p.reject(new Error("embedder worker exited"));
    _pending.clear();
    _worker = null;
  });
  // unref : le worker ne maintient pas le process en vie (utile aux scripts CLI).
  _worker.unref();
  return _worker;
}

/** Calcule l'embedding d'un texte. kind : "passage" (document) ou "query". */
export function embed(text, kind = "passage") {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, text, kind });
    } catch (e) {
      _pending.delete(id);
      reject(e);
    }
  });
}

/** Pré-charge le modèle dans le worker (utile au boot du serveur). */
export async function warmupEmbedder() {
  await embed("warmup", "query");
}

/** Format pgvector. */
export function toPgVector(arr) {
  return `[${arr.join(",")}]`;
}

/** Termine le worker (à appeler depuis les scripts CLI avant de quitter). */
export async function shutdownEmbedder() {
  if (_worker) {
    const w = _worker;
    _worker = null;
    await w.terminate();
  }
}
