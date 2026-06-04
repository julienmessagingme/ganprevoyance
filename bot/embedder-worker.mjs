// Worker dédié à l'inférence d'embeddings — isole le calcul CPU du process
// principal pour ne pas bloquer la boucle d'événements du serveur HTTP.
// Charge le modèle une seule fois ; répond aux messages { id, text, kind }
// par { id, vec } ou { id, error }.
import { parentPort } from "node:worker_threads";
import { pipeline, env as xenvEnv } from "@xenova/transformers";

xenvEnv.allowLocalModels = false;
const MODEL = "Xenova/multilingual-e5-base";

let pipePromise = null;
async function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          return await pipeline("feature-extraction", MODEL);
        } catch (e) {
          if (attempt === 4) throw e;
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
    })().catch((e) => {
      pipePromise = null;
      throw e;
    });
  }
  return pipePromise;
}

parentPort.on("message", async (msg) => {
  const { id, text, kind } = msg;
  try {
    const pipe = await getPipe();
    const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 2000);
    const out = await pipe(`${kind}: ${clean}`, {
      pooling: "mean",
      normalize: true,
    });
    parentPort.postMessage({ id, vec: Array.from(out.data) });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.message || e) });
  }
});
