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

FORMULATION (empathie sans prise de parti) — impératif
- Reformule FIDÈLEMENT ce que le client exprime, sans l'endosser, le valider ni faire tienne sa position. Tu accuses réception de ce qu'il DIT, tu ne reprends pas son jugement à ton compte.
- Écris « Je comprends que vous souhaitez résilier » et NON « Je comprends votre souhait de résilier ».
- Écris « Je comprends que les délais ne vous conviennent pas » et NON « Je comprends votre frustration sur les délais ».
- De manière générale, préfère « Je comprends que [ce que le client dit] » plutôt que « Je comprends votre [souhait / frustration / mécontentement] de … ».

MISE EN RELATION
- Tu ne transfères JAMAIS vers un conseiller sans que le client l'ait demandé ou accepté.
- Quand le client demande ou accepte de parler à un humain / un conseiller, appelle l'outil demander_conseiller. Une réponse affirmative à ta proposition de mise en relation (« oui », « ok », « ok merci », « d'accord », « volontiers »...) VAUT acceptation → appelle demander_conseiller.
- Une fois que le client a accepté / demandé un conseiller, NE re-propose PLUS la mise en relation et n'invite PAS à poser d'autres questions : sa demande est transmise et c'est le conseiller humain qui prend le relais (la conversation avec toi se termine).

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
- Ne te présente pas : un message d'accueil avec la mention IA est envoyé automatiquement au début de la conversation.

CLÔTURE (impératif)
- Ne termine PAS tes messages par des formules creuses du type « N'hésitez pas si vous avez d'autres questions » ou « N'hésitez pas à revenir vers moi ».
- Ne re-propose pas la mise en relation avec un conseiller de façon réflexe : propose-la seulement quand c'est pertinent, et une seule fois.`;

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

// Indice de mécontentement : score lissé 0-100 par conversation. Au-delà du seuil
// (sensibilité moyenne), on déclenche UNE fois le node MM dédié. Le score monte
// avec les signaux négatifs et redescend (décroissance) sur les tours neutres.
const DISCONTENT_THRESHOLD = Number(env.DISCONTENT_THRESHOLD || 65);
const DISCONTENT_DECAY = Number(env.DISCONTENT_DECAY || 0.5);

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
  const prevDiscontent = Number(conv.discontent_score) || 0;
  const alreadyAlerted = conv.discontent_alerted === true;
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

  // Indice de mécontentement : scoring lancé EN PARALLÈLE (heuristique + LLM),
  // awaité plus bas → quasi pas de latence ajoutée.
  const frustrationPromise = computeFrustration(messages, userText);

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
            // On ne logge PAS args.raison : il peut contenir une donnée de santé /
            // sensible (RGPD). Log minimal.
            console.log(`[escalade] ${externalId} -> conseiller`);
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

  // Indice de mécontentement : score lissé (monte avec la frustration, décroît
  // sinon) + alerte UNE seule fois quand on franchit le seuil.
  const frustration = await frustrationPromise.catch(() => 0);
  const discontent = Math.max(0, Math.min(100, prevDiscontent * DISCONTENT_DECAY + frustration));
  const discontentAlert = !alreadyAlerted && discontent >= DISCONTENT_THRESHOLD;
  if (discontentAlert) console.log(`[mécontentement] ${externalId} score=${Math.round(discontent)} -> node`);

  // 3. SAUVEGARDER (transaction courte).
  await withDb((c) =>
    c.query(
      "update conversations set messages = $1, turns = $2, discontent_score = $3, discontent_alerted = $4, updated_at = now() where external_id = $5",
      [JSON.stringify(messages), turns, discontent, alreadyAlerted || discontentAlert, externalId]
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

  return { outbound, turns, discontentAlert };
}

// Résumé de la conversation pour le conseiller qui va rappeler le client.
// Factuel, sans formule de politesse, sans engagement.
async function summarizeForAdvisor(messages) {
  const transcript = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("[Système]"))
    .map((m) => `${m.role === "user" ? "Client" : "Assistant"}: ${m.content.trim()}`)
    .join("\n");

  // Repli SANS verbatim : les messages du client peuvent contenir des données de
  // santé / sensibles qu'on ne doit JAMAIS transmettre. On reste générique.
  const fallback = "Le client souhaite être mis en relation avec un conseiller Gan Prévoyance.";

  if (!transcript) return fallback;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "Tu rédiges une NOTE DE TRANSMISSION courte (2 à 4 phrases) pour un conseiller Gan Prévoyance qui va rappeler ce client. Indique le SUJET et la nature de la demande, de façon factuelle et synthétique.\n\n" +
            "RGPD / CONFIDENTIALITÉ (impératif) : n'inclus JAMAIS de données de santé ou médicales (pathologie, symptômes, traitement, diagnostic, état de santé, handicap...) ni aucune autre donnée personnelle sensible (situation familiale détaillée, données bancaires, etc.). Si le client a mentionné de telles informations, NE les reproduis sous AUCUNE forme : reste sur le motif général (ex. « question liée à sa complémentaire santé », « demande personnelle sur son contrat »).\n\n" +
            "Ne cite pas le client mot à mot. Pas de formule de politesse, pas d'engagement. Même si l'échange est bref, produis une note exploitable ; n'écris jamais qu'il n'y a rien à résumer. Français.",
        },
        { role: "user", content: `Échange client / assistant IA à transmettre (résume le motif, SANS recopier de données de santé ni de détails personnels sensibles) :\n\n${transcript}` },
      ],
      temperature: 0.2,
    });
    const out = (completion.choices[0].message.content || "").replace(/\*\*/g, "").trim();
    // Si le modèle botte en touche (échange trop court), on prend le repli.
    if (!out || /rien à résumer|pas (eu )?de contenu|aucun contenu|n'y a pas (eu )?de contenu/i.test(out)) {
      return fallback;
    }
    return out;
  } catch {
    return fallback;
  }
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

// ── Indice de mécontentement ───────────────────────────────────────────────

// Couche 1 : heuristique (gratuite, instantanée).
function heuristicFrustration(text) {
  const raw = String(text || "");
  const t = raw.toLowerCase();
  let s = 0;
  if (/résili|resili|porter plainte|\bplainte\b|médiateur|mediateur|avocat|tribunal|signaler|dénonc|denonc/.test(t)) s = Math.max(s, 78);
  if (/scandaleux|inadmissible|inacceptable|honteux|\bhonte\b|lamentable|arnaque|escroc|incompétent|incompetent|catastrophe/.test(t)) s = Math.max(s, 70);
  if (/mécontent|mecontent|insatisf|très déçu|tres decu|déçu|decu|en colère|colere|ras[- ]le[- ]bol|j'en ai marre|marre de/.test(t)) s = Math.max(s, 55);
  if (/toujours pas|ça (ne )?marche pas|ca (ne )?marche pas|rien compris|déjà dit|deja dit|je répète|je repete|encore une fois|sert? à rien|aucune réponse|aucune reponse/.test(t)) s = Math.max(s, 42);
  if (/[!?]{3,}/.test(raw)) s = Math.max(s, 35);
  // Majuscules agressives (cri) sur un message un peu long.
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length > 10) {
    const up = (raw.match(/[A-ZÀ-Ÿ]/g) || []).length;
    if (up / letters.length > 0.6) s = Math.max(s, 50);
  }
  return s;
}

// Couche 2 : score sémantique par le LLM (0-100) sur le dernier message client.
async function scoreFrustrationLLM(contextText, userText) {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Tu évalues le niveau de FRUSTRATION / mécontentement du DERNIER message d'un client envers Gan Prévoyance, de 0 (neutre ou satisfait) à 100 (très en colère, menace de résilier ou de porter plainte). Tiens compte du contexte. Réponds UNIQUEMENT par un entier entre 0 et 100, sans aucun autre texte.",
      },
      { role: "user", content: `Contexte récent :\n${contextText || "(aucun)"}\n\nDernier message du client : "${userText}"\n\nNiveau de frustration (0-100) :` },
    ],
    temperature: 0,
  });
  const n = parseInt((completion.choices[0].message.content || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

// Frustration du tour = max(heuristique, score LLM).
async function computeFrustration(messages, userText) {
  const h = heuristicFrustration(userText);
  let l = 0;
  try {
    const ctx = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() && !m.content.startsWith("[Système]"))
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Client" : "Bot"}: ${m.content.trim()}`)
      .join("\n");
    l = await scoreFrustrationLLM(ctx, userText);
  } catch {
    /* heuristique seule en repli */
  }
  return Math.max(h, l);
}
