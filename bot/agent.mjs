// Agent conversationnel Gan Prévoyance — répond aux questions assurance des
// clients sur WhatsApp à partir de la base de connaissance (RAG), via Gemini 2.5.
//
// ⚠️ CONFORMITÉ (exigences Groupe / conformité / DRPO) — non négociable :
//  - l'agent ORIENTE et INFORME, ne DÉCIDE jamais, ne RECOMMANDE jamais d'acte
//    engageant, ne prend JAMAIS position sur la faisabilité d'un acte de gestion ;
//  - mention IA obligatoire en début de conversation (injectée EN DUR ici, pas
//    laissée au modèle) : robot + clause d'information/responsabilité ;
//  - mécontentement : empathie sobre, AUCUNE reconnaissance de faute, AUCUN
//    engagement, bascule conseiller ;
//  - transfert vers un humain UNIQUEMENT si le client le demande/accepte.
//
// Principes techniques (cf. brain/LEARNINGS.md) : provider switchable via couche
// OpenAI-compat ; garde-fous CODE plutôt que "règles d'or" prompt ; transactions
// DB courtes (aucune connexion tenue pendant les appels LLM) ; mutex par user.
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

// ── Message d'accueil + mention IA (envoyé EN DUR au 1er tour) ──────────────
// Garantit la transparence IA exigée par la conformité, quel que soit le modèle.
const INTRO =
  "🤖 Bonjour, vous échangez avec l'assistant virtuel de Gan Prévoyance, basé sur une intelligence artificielle. Mes réponses ont une vocation informative et ne remplacent pas l'analyse d'un conseiller ; certaines informations peuvent être incomplètes ou inexactes. Pour toute demande nécessitant une analyse personnalisée, je vous inviterai à contacter votre conseiller ou notre service client. Si vous souhaitez parler à un conseiller, dites-le moi simplement.";

// ── System prompt ──────────────────────────────────────────────────────────
const SYSTEM = `Tu es l'assistant virtuel de Gan Prévoyance sur WhatsApp : un robot basé sur une intelligence artificielle. Tu réponds aux questions des clients et prospects sur Gan Prévoyance et ses domaines (prévoyance, santé, épargne, retraite, obsèques, accidents, assurance des emprunteurs...).

RÔLE ET LIMITES (impératif)
- Tu ORIENTES et INFORMES. Tu ne DÉCIDES jamais, tu ne RECOMMANDES jamais un acte engageant, et tu ne prends JAMAIS position sur ce qu'il est possible ou non de faire sur un contrat.
- Tu n'as AUCUN accès aux dossiers, contrats, cotisations, soldes, sinistres ni données personnelles des clients.
- Tes réponses sont strictement informatives et générales ; elles ne se substituent jamais à un conseiller.

CONTRAT PRÉCIS / ACTE DE GESTION
Si la demande porte sur un contrat précis, un acte de gestion (résiliation, rachat, solde ou clôture, déblocage, virement, modification, indemnités...), un montant / solde / délai individuel, un sinistre en cours, ou cite un numéro de contrat :
- réponds que tu ne peux pas renseigner sur un dossier précis ni réaliser d'action sur un contrat ;
- ne donne AUCUNE indication sur la faisabilité de l'acte ;
- propose, si le client le souhaite, la mise en relation avec un conseiller Gan Prévoyance.

MÉCONTENTEMENT / RÉCLAMATION
- Accuse réception avec une empathie sobre et mesurée.
- Ne reconnais JAMAIS de faute, d'erreur ni de problème, et n'emploie aucune formulation pouvant valoir reconnaissance implicite.
- Ne prends AUCUN engagement (aucune promesse, aucun délai, aucune action).
- Propose rapidement la mise en relation avec un conseiller.

MISE EN RELATION
- Tu ne transfères JAMAIS vers un conseiller sans que le client l'ait demandé ou accepté.
- Quand le client demande ou accepte de parler à un humain / un conseiller, appelle l'outil demander_conseiller.

RÉPONSES
- Des extraits de la base de connaissance officielle Gan Prévoyance te sont fournis plus bas (section BASE DE CONNAISSANCE). Réponds aux questions d'information en t'appuyant sur ces extraits, de façon claire et naturelle.
- Si les extraits fournis ne permettent pas de répondre, dis simplement que tu ne disposes pas de cette information et propose, si le client le souhaite, un conseiller.
- Ne mentionne JAMAIS tes sources, ta base de connaissance, ni de documents : réponds comme si tu connaissais l'information.

PÉRIMÈTRE
- Tu réponds uniquement sur Gan Prévoyance, l'assurance et l'épargne. Pour toute demande hors sujet, redis poliment que tu es là pour les aider sur leurs contrats d'assurance ou d'épargne. Un small talk bref est accepté, mais recentre habilement.

INTERDICTIONS
- Ne vérifie jamais l'identité ni l'adresse du client.
- Ne propose jamais d'analyser un document envoyé par le client.
- Ne propose jamais de recontacter le client ou de revenir vers lui plus tard.
- N'invite jamais à laisser un avis.
- N'invente jamais de montants, taux, garanties, délais ni conditions.

STYLE
- Français, vouvoiement, professionnel, synthétique, chaleureux et positif.
- Réponses courtes (2 à 4 phrases). Au plus 1 emoji.
- Ne te présente pas : un message d'accueil avec la mention IA est envoyé automatiquement au début de la conversation.`;

// ── Outils ─────────────────────────────────────────────────────────────────
// La recherche KB est FAITE EN DUR (RAG déterministe) à chaque tour, pas via un
// outil : Gemini n'appelle pas l'outil de façon fiable (cf. LEARNINGS), et un bot
// d'information DOIT toujours être fondé sur la base. Seule l'escalade conseiller
// reste un outil (c'est une action, décidée par le modèle selon l'intention).
const TOOLS = [
  {
    type: "function",
    function: {
      name: "demander_conseiller",
      description:
        "Met le client en relation avec un conseiller humain Gan Prévoyance. À appeler UNIQUEMENT lorsque le client a demandé ou explicitement accepté de parler à un conseiller / un humain. Ne jamais l'appeler de ta propre initiative.",
      parameters: {
        type: "object",
        properties: {
          raison: { type: "string", description: "Brève raison de la mise en relation (pour le log)." },
        },
        required: [],
      },
    },
  },
];

// ── Historique ─────────────────────────────────────────────────────────────
const MAX_MESSAGES = Number(env.MAX_HISTORY_MESSAGES || 20);

function pruneHistory(messages) {
  let msgs = messages.slice(-MAX_MESSAGES);
  while (msgs.length && (msgs[0].role === "tool" || (msgs[0].role === "assistant" && msgs[0].tool_calls))) {
    msgs = msgs.slice(1);
  }
  return msgs;
}

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

  // Mention IA obligatoire (conformité) : on l'envoie quand l'IA n'a encore JAMAIS
  // parlé dans cette conversation, OU quand le client revient après une coupure
  // (nouvelle session). Robuste, indépendant du compteur `turns` (qui peut être
  // > 1 sur une conversation pré-existante sans que l'intro ait été envoyée).
  const hadAssistant = messages.some((m) => m.role === "assistant");
  let gapMs = Infinity;
  if (conv.updated_at) {
    const t = new Date(conv.updated_at).getTime();
    if (Number.isFinite(t)) gapMs = Date.now() - t;
  }
  const SESSION_GAP_MS = Number(env.SESSION_GAP_HOURS || 6) * 3_600_000;
  const showIntro = !hadAssistant || gapMs > SESSION_GAP_MS;

  messages.push({ role: "user", content: userText });

  // Garde-fous CODE de conformité : si la demande touche un contrat précis / un
  // acte de gestion / une réclamation, on rappelle au modèle la conduite à tenir
  // AVANT qu'il réponde (réactif > règle statique lointaine).
  if (looksLikeIndividualOrEngaging(userText)) {
    messages.push({
      role: "user",
      content:
        "[Système] La demande semble porter sur un contrat précis ou un acte de gestion. Rappel impératif : tu ne renseignes pas sur un dossier précis, tu n'agis pas, tu ne prends pas position sur la faisabilité ; indique-le et propose, si le client le souhaite, un conseiller.",
    });
  } else if (looksLikeComplaint(userText)) {
    messages.push({
      role: "user",
      content:
        "[Système] Le client exprime du mécontentement. Rappel impératif : empathie sobre, AUCUNE reconnaissance de faute ou d'erreur, AUCUN engagement ni promesse, puis propose rapidement la mise en relation avec un conseiller.",
    });
  }

  // RAG DÉTERMINISTE : on récupère en dur les passages KB pertinents pour le
  // message courant et on les injecte dans le system. Le modèle répond à partir
  // de là (plus fiable que de lui laisser décider d'appeler un outil de recherche).
  let kbContext = "";
  try {
    const passages = await searchKb({ texteLibre: userText, limit: KB_LIMIT, traceId: externalId });
    if (passages.length) {
      kbContext =
        "\n\nBASE DE CONNAISSANCE GAN PRÉVOYANCE (extraits internes pour fonder ta réponse ; ne jamais les citer ni mentionner de source) :\n" +
        passages.map((p, i) => `[${i + 1}] ${p.title ? p.title + " — " : ""}${p.content}`).join("\n---\n");
    }
  } catch (e) {
    console.error(`[kb] échec recherche ${externalId}:`, e.message);
  }
  const systemContent = SYSTEM + kbContext;

  let escalate = false;
  let textReply = "Je n'ai pas réussi à traiter votre demande. Pouvez-vous la reformuler ?";

  // BOUCLE LLM (aucune connexion DB tenue ici). Seul l'outil demander_conseiller
  // peut être appelé (action d'escalade).
  for (let step = 0; step < 4; step++) {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: systemContent }, ...messages],
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
          if (tc.function.name === "demander_conseiller") {
            escalate = true;
            console.log(`[escalade] ${externalId} :: ${args.raison || "(sans raison)"}`);
            result = { ok: true, message: "Mise en relation déclenchée." };
          } else {
            result = { erreur: `outil inconnu: ${tc.function.name}` };
          }
        } catch (e) {
          result = { erreur: String(e.message) };
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    textReply = assistantMsg.content || textReply;
    break;
  }

  // 3. SAUVEGARDER (transaction courte).
  await withDb((c) =>
    c.query(
      "update conversations set messages = $1, turns = $2, updated_at = now() where external_id = $3",
      [JSON.stringify(messages), turns, externalId]
    )
  );

  // Si escalade : résumé de la conversation pour le conseiller (écrit dans le
  // user field MM par mmclient avant de déclencher le node de transfert).
  let summary = null;
  if (escalate) {
    try {
      summary = await summarizeForAdvisor(messages);
    } catch (e) {
      console.error(`[résumé] échec ${externalId}:`, e.message);
    }
  }

  // 4. Construire les sorties. Mention IA EN DUR au 1er tour (conformité).
  const outbound = [];
  if (showIntro) outbound.push({ type: "text", text: INTRO });
  if (escalate && helpNodeEnabled) {
    // Le node de transfert envoie lui-même le message de confirmation -> on ne
    // double pas avec le texte du modèle.
    outbound.push({ type: "help", summary });
  } else if (textReply && textReply.trim()) {
    outbound.push({ type: "text", text: textReply.trim() });
  }
  if (!outbound.length) outbound.push({ type: "text", text: "Pouvez-vous préciser votre demande ?" });

  return { outbound, turns };
}

// Résumé de la conversation pour le conseiller qui va rappeler le client.
// Factuel, sans formule de politesse, sans engagement.
async function summarizeForAdvisor(messages) {
  const transcript = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("[Système]"))
    .map((m) => `${m.role === "user" ? "Client" : "Assistant"}: ${m.content.trim()}`)
    .join("\n");
  if (!transcript) return null;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Tu produis, pour un conseiller Gan Prévoyance qui va rappeler ce client, un résumé FACTUEL et concis (3 à 5 phrases) de l'échange du client avec l'assistant IA. Indique le sujet principal et ce que le client cherche / son contexte. Pas de formule de politesse, pas d'engagement, pas de recommandation d'action. Français.",
      },
      { role: "user", content: `Échange à résumer :\n\n${transcript}` },
    ],
    temperature: 0.2,
  });
  return (completion.choices[0].message.content || "").trim() || null;
}

// ── Heuristiques de détection (garde-fous d'entrée) ────────────────────────

// Demande touchant un contrat précis / un acte de gestion / un montant individuel.
function looksLikeIndividualOrEngaging(text) {
  const t = String(text || "").toLowerCase();
  return /\bsold|solder|résili|resili|rachat|rachet|clôtur|cloturer|débloc|debloc|virement|indemnit|mon contrat|mes contrats|mon dossier|mon per\b|mon solde|ma cotisation|mes cotisations|mon sinistre|numéro de contrat|n°|mon adhésion|résilier|annuler mon|modifier mon|mon échéance|mes prestations|mon remboursement\b/.test(
    t
  );
}

// Mécontentement / réclamation.
function looksLikeComplaint(text) {
  const t = String(text || "").toLowerCase();
  return /mécontent|mecontent|insatisf|réclamation|reclamation|scandaleux|inadmissible|déçu|decu|inacceptable|honteux|arnaque|porter plainte|plainte|en colère|colere|lamentable|incompétent|incompetent|nul\b|catastrophe/.test(
    t
  );
}
