// Agent conversationnel Gan Prévoyance — répond aux questions assurance des
// clients sur WhatsApp à partir de la base de connaissance (RAG), via Gemini 2.5.
//
// Principes (cf. brain/LEARNINGS.md) :
//  - provider switchable via couche OpenAI-compat (un patch d'env, pas de refacto) ;
//  - tool-calling fiabilisé par garde-fous CODE, pas par "règles d'or" prompt ;
//  - transactions DB COURTES : aucune connexion tenue pendant les appels LLM ;
//  - sérialisation par utilisateur (mutex en mémoire) pour gérer les doublons.
import OpenAI from "openai";
import { env, withDb } from "./db.mjs";
import { searchKb } from "./search.mjs";
import { helpNodeEnabled } from "./mmclient.mjs";

// ── Provider LLM ───────────────────────────────────────────────────────────
const PROVIDERS = {
  openai: { baseURL: undefined, key: env.OPENAI_API_KEY, defaultModel: "gpt-4o-mini" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    key: env.GEMINI_API_KEY,
    defaultModel: "gemini-2.5-flash",
  },
};
const PROVIDER = env.LLM_PROVIDER || "gemini";
const PROVIDER_CFG = PROVIDERS[PROVIDER] || PROVIDERS.gemini;
const MODEL = env.LLM_MODEL || PROVIDER_CFG.defaultModel;

const openai = new OpenAI({
  apiKey: PROVIDER_CFG.key,
  baseURL: PROVIDER_CFG.baseURL,
  timeout: 30000,
  maxRetries: Number(env.LLM_MAX_RETRIES || 4),
});

// ── System prompt ──────────────────────────────────────────────────────────
// Ton : conseiller assurance clair, rassurant, concis. Le garde-fou ANTI-
// HALLUCINATION est central : en assurance, inventer une garantie / un montant /
// une démarche est un risque réel. On ne répond QUE depuis la base de
// connaissance ; à défaut, on oriente vers un conseiller.
const SYSTEM = `Tu es l'assistant virtuel de Gan Prévoyance sur WhatsApp. Tu réponds aux questions des clients et prospects sur les produits, garanties, démarches et services de Gan Prévoyance (prévoyance, santé, épargne, retraite, assurance des emprunteurs, etc.).

STYLE
- Français, chaleureux et professionnel, tutoiement non : vouvoie le client.
- Réponses courtes et claires (2 à 5 phrases). Pas de jargon inutile.
- Au plus 1 emoji, seulement s'il est pertinent.

MÉTHODE (impérative)
- Pour TOUTE question factuelle (produit, garantie, condition, démarche, sinistre, document, délai...), appelle d'ABORD l'outil rechercher_kb pour récupérer l'information officielle, PUIS réponds en t'appuyant uniquement dessus.
- Tu ne dois JAMAIS inventer ni supposer : montants, taux, plafonds, exclusions, délais, conditions précises d'un contrat. Si l'information n'est pas dans les passages récupérés, dis-le clairement et propose la mise en relation avec un conseiller.
- Tu n'as AUCUN accès au dossier personnel du client (son contrat, ses cotisations, un sinistre en cours). Pour tout ce qui touche à sa situation personnelle, utilise demander_conseiller.

QUAND ESCALADER (demander_conseiller)
- Le client demande à parler à un humain / un conseiller.
- La question porte sur SON contrat, SON sinistre, SES données personnelles.
- C'est une réclamation, une résiliation, une situation sensible.
- La base de connaissance ne permet pas de répondre avec certitude.

Termine si utile par une question ouverte courte pour aider davantage.`;

// ── Outils ─────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "rechercher_kb",
      description:
        "Recherche dans la base de connaissance officielle Gan Prévoyance (FAQ + pages produits/garanties) les passages pertinents. À appeler AVANT de répondre à toute question factuelle.",
      parameters: {
        type: "object",
        properties: {
          requete: {
            type: "string",
            description: "La question ou les mots-clés à rechercher, reformulés clairement en français.",
          },
        },
        required: ["requete"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "demander_conseiller",
      description:
        "Met le client en relation avec un conseiller humain Gan Prévoyance. À utiliser si le client le demande, si la question porte sur sa situation personnelle (son contrat, un sinistre, ses données), s'il s'agit d'une réclamation/résiliation, ou si la base de connaissance ne suffit pas.",
      parameters: {
        type: "object",
        properties: {
          raison: { type: "string", description: "Brève raison de l'escalade (pour le log)." },
        },
        required: [],
      },
    },
  },
];

// ── Historique ─────────────────────────────────────────────────────────────
const MAX_MESSAGES = Number(env.MAX_HISTORY_MESSAGES || 20);

// Tronque l'historique aux derniers MAX_MESSAGES, sans laisser d'orphelin en
// tête (un message 'tool' ou un assistant avec tool_calls non résolus en
// première position casse l'API).
function pruneHistory(messages) {
  let msgs = messages.slice(-MAX_MESSAGES);
  while (msgs.length && (msgs[0].role === "tool" || (msgs[0].role === "assistant" && msgs[0].tool_calls))) {
    msgs = msgs.slice(1);
  }
  return msgs;
}

// Normalise le message assistant renvoyé par la couche compat (tool_calls peut
// être absent ou null ; content peut être null quand il n'y a que des tool_calls).
function normalizeAssistant(m) {
  const out = { role: "assistant", content: m.content ?? "" };
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) out.tool_calls = m.tool_calls;
  return out;
}

const KB_LIMIT = Number(env.KB_LIMIT || 5);

// ── Sérialisation par utilisateur (mutex mémoire) ──────────────────────────
const userChains = new Map();
export function handleMessage(externalId, userText) {
  const prev = userChains.get(externalId) || Promise.resolve();
  const run = prev.then(
    () => processMessage(externalId, userText),
    () => processMessage(externalId, userText)
  );
  const tail = run.catch(() => {});
  userChains.set(externalId, tail);
  tail.then(() => {
    if (userChains.get(externalId) === tail) userChains.delete(externalId);
  });
  return run;
}

// ── Boucle principale ──────────────────────────────────────────────────────
async function processMessage(externalId, userText) {
  // 1. CHARGER la conversation (transaction courte).
  const conv = await withDb(async (c) => {
    await c.query(
      "insert into conversations (external_id) values ($1) on conflict (external_id) do nothing",
      [externalId]
    );
    const { rows } = await c.query("select * from conversations where external_id = $1", [externalId]);
    return rows[0];
  });

  const turns = (conv.turns || 0) + 1;
  const messages = pruneHistory(Array.isArray(conv.messages) ? conv.messages : []);
  messages.push({ role: "user", content: userText });

  let escalate = false;
  let didSearch = false;
  let nudgedSearch = false;
  let textReply = "Désolé, je n'ai pas réussi à répondre. Pouvez-vous reformuler ?";

  // 2. BOUCLE LLM (aucune connexion DB tenue ici).
  for (let step = 0; step < 5; step++) {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
      tools: TOOLS,
      temperature: 0.3,
    });

    const assistantMsg = normalizeAssistant(completion.choices[0].message);
    messages.push(assistantMsg);

    if (assistantMsg.tool_calls) {
      for (const tc of assistantMsg.tool_calls) {
        let result;
        try {
          const args = JSON.parse(tc.function.arguments || "{}");
          if (tc.function.name === "rechercher_kb") {
            didSearch = true;
            const found = await searchKb({ texteLibre: args.requete || userText, limit: KB_LIMIT, traceId: externalId });
            result = { passages: found };
          } else if (tc.function.name === "demander_conseiller") {
            escalate = true;
            console.log(`[escalade] ${externalId} :: ${args.raison || "(sans raison)"}`);
            result = { ok: true, message: "Mise en relation avec un conseiller déclenchée." };
          } else {
            result = { erreur: `outil inconnu: ${tc.function.name}` };
          }
        } catch (e) {
          result = { erreur: String(e.message) };
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue; // relance le LLM avec les résultats d'outils
    }

    // Réponse texte finale.
    textReply = assistantMsg.content || textReply;

    // Garde-fou réactif : si le modèle répond à une vraie question SANS avoir
    // cherché ni escaladé, on le pousse à fonder sa réponse une fois (cf.
    // LEARNINGS : nudge réactif > règle statique). On ne force pas tool_choice
    // (inutilisable côté Gemini).
    if (!didSearch && !escalate && !nudgedSearch && looksLikeFactualQuestion(userText)) {
      nudgedSearch = true;
      messages.push({
        role: "user",
        content:
          "[Système] Avant de répondre, appelle rechercher_kb pour fonder ta réponse sur la base de connaissance officielle Gan Prévoyance. Si rien de pertinent n'en ressort, propose un conseiller via demander_conseiller.",
      });
      continue;
    }

    break;
  }

  // 3. SAUVEGARDER (transaction courte).
  await withDb((c) =>
    c.query(
      "update conversations set messages = $1, turns = $2, updated_at = now() where external_id = $3",
      [JSON.stringify(messages), turns, externalId]
    )
  );

  // 4. Construire les sorties.
  const outbound = [];
  if (textReply && textReply.trim()) outbound.push({ type: "text", text: textReply.trim() });
  if (escalate && helpNodeEnabled) outbound.push({ type: "help" });
  if (!outbound.length) outbound.push({ type: "text", text: "Pouvez-vous reformuler votre question ?" });

  return { outbound, turns };
}

// Heuristique légère : le message ressemble-t-il à une question factuelle qui
// mérite une recherche KB ? (évite de nudger sur "bonjour", "merci", "ok"...)
function looksLikeFactualQuestion(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.length < 8) return false;
  const smalltalk = /^(bonjour|bonsoir|salut|merci|ok|d'accord|au revoir|ça va|coucou)\b/;
  if (smalltalk.test(t) && t.length < 25) return false;
  return /\?|comment|quel|quelle|quels|quelles|combien|pourquoi|est-ce|puis-je|peut-on|garantie|contrat|cotisation|sinistre|remboursement|résili|souscri|délai|document|tarif|prix|couver/.test(
    t
  );
}
