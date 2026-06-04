// REPL de test local de l'agent (sans MessagingMe) : tape une question, vois la
// réponse de l'agent. Utilise un external_id de test. Ctrl+C pour quitter.
//   node chat-cli.mjs
import readline from "node:readline";
import { handleMessage } from "./agent.mjs";
import { closePool } from "./db.mjs";
import { shutdownEmbedder } from "./embedder.mjs";

const EXTERNAL_ID = process.env.CHAT_ID || "cli-test";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

console.log(`Agent Gan Prévoyance (CLI) — external_id=${EXTERNAL_ID}. Ctrl+C pour quitter.\n`);

while (true) {
  const msg = await ask("Vous : ");
  if (!msg.trim()) continue;
  try {
    const { outbound, turns } = await handleMessage(EXTERNAL_ID, msg.trim());
    for (const m of outbound) {
      if (m.type === "help") console.log(`Bot  : [escalade conseiller]`);
      else console.log(`Bot  : ${m.text}`);
    }
    console.log(`       (tour ${turns})\n`);
  } catch (e) {
    console.error("Erreur :", e.message, "\n");
  }
}
