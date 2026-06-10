# CLAUDE.md — Gan Prévoyance

Projet client Gan Prévoyance (assurance/prévoyance), relié à messagingme.app
(workspace **291825**). Un repo, deux services sur le même domaine
**`ganprevoyance.messagingme.app`** :

1. **`dashboard/`** — dashboard de pilotage type Neoma : custom events MessagingMe,
   URLs trackées, stats, tableaux (funnels/pie), campagnes, base de connaissance,
   admin. Next.js 15 + Supabase (base partagée EDH/Neoma, `school_slug='gan-prev'`).
   Déployé en **Docker**, NPM sert la racine `/`.
2. **`bot/`** — bot WhatsApp : agent IA **Gemini 2.5** qui répond aux questions
   clients à partir d'une base de connaissance assurance (RAG pgvector, embeddings
   locaux e5-base). Node + Supabase dédié. Déployé en **PM2**, NPM route
   `/webhook` + `/health`.

## Documentation

- **[documentation.md](documentation.md)** — archi, stack, schéma DB, env vars, déploiement
- **[features.md](features.md)** — vue produit (dashboard + bot)
- **[wip.md](wip.md)** — travail en cours
- **[todo.md](todo.md)** — backlog

## Commandes essentielles

### Dashboard (`cd dashboard`)
```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # build prod (Next standalone)
npm test             # vitest
npm run seed:users   # seed admin julien@messagingme.fr (lit .env.local)
```

### Bot (`cd bot`)
```bash
npm install
npm run setup-db     # applique schema.sql sur le Supabase Gan Prévoyance
npm run scrape       # scrape ganprevoyance.fr -> kb_chunks
npm run embed        # vectorise les chunks (e5-base, 768-dim)
npm run ingest-docx -- "chemin/doc.docx"   # ingère un .docx dans la KB (puis embed)
npm run chat         # REPL de test local de l'agent
npm start            # serveur webhook (port 8130)
```

## Règles spécifiques au projet

- **Repo PUBLIC** (`julienmessagingme/ganprevoyance`) : aucun secret en clair.
  Tout dans `.env` / `.env.local` (gitignorés). Toujours vérifier avant un push.
- **Dashboard** : base **partagée EDH/Neoma** (`odmpeakltuzwvtydbpfu`), isolation
  par `school_slug='gan-prev'`. Aucune migration : on n'ajoute que des rows.
- **⚠️ Sync custom events corrigé** : contrairement à Neoma (bug LEARNINGS
  2026-06-02), le sync ici pagine par **curseur `start_id` croissant** (cap 100),
  sans break précoce, watermark = max id inséré. Ne JAMAIS revenir au page-based
  descendant.
- **Bot assurance = conforme + anti-hallucination** : l'agent ORIENTE sans décider,
  n'invente jamais montants/garanties/délais, **mention IA envoyée EN DUR au 1er message
  IA** (conformité Groupe), répond depuis la KB en **RAG DÉTERMINISTE** (recherche
  injectée en dur dans le system, PAS via un outil — Gemini n'appelle pas l'outil de
  façon fiable). Seul outil = `demander_conseiller` (escalade, sur demande/cas personnel).
- **Escalade conseiller** : node `MM_HELP_NODE_NS=f266213n450294757` + **résumé de la
  conversation FILTRÉ RGPD** (jamais de données de santé/sensibles, pas de verbatim) écrit
  dans le user field `MM_SUMMARY_FIELD_NS=f266213v13539241` (set par var_ns). Une réponse
  affirmative ("ok merci", "oui") vaut acceptation ; après acceptation, aucune re-proposition
  ni closing creux ("n'hésitez pas...").
- **Indice de mécontentement** : score lissé 0-100 (heuristique + LLM) par conversation ;
  au seuil `DISCONTENT_THRESHOLD` (65, moyen), déclenche UNE fois le node
  `MM_DISCONTENT_NODE_NS=f266213n450834377`. Pas d'auto-escalade.
- **Rétention RGPD** : purge des conversations inactives > `CONV_RETENTION_DAYS` (30 j),
  au boot + 1×/jour (`purge-conv.mjs`). Les messages peuvent contenir des données de santé.
- **KB du bot = source UNIQUE** (`kb_chunks` pgvector, projet dédié). L'onglet "Base de
  connaissance" du dashboard la PILOTE via l'API bot `/kb/list|get|upsert|delete`
  (lib `bot-kb.ts`, env `BOT_KB_URL`/`BOT_KB_SECRET`). **OpenAI entièrement retiré.**
  Recherche du bot = **HYBRIDE** (sémantique pgvector + mots-clés ILIKE) pour fiabiliser
  le factuel. Recherche dans l'onglet via `/kb/list?q=`. Ajout de docs : `npm run ingest-docx`.
- **Prod / test** : bot en prod (`NO_SEND=0`). `SEND_ALLOWLIST=<user_ns,…>` = ne répondre
  qu'à certains contacts (test sans diffuser) ; `NO_SEND=1` = couper tout envoi.
- **Landing dashboard** : `/` redirige vers `/knowledge` (Base de connaissance).
- **Bot DB** : projet Supabase dédié `etmdddhgikihybjufqwq`, connexion Postgres directe
  (`pg`) + pgvector, via le **pooler** `aws-1-eu-central-1` (direct IPv6 KO). Pas le MCP
  Supabase (autre org). ⚠️ supabase-js (dashboard) : toujours `await` les mutations
  (un `void` non awaité ne part jamais — cf. LEARNINGS 2026-06-05).
- **Git** : tout sur `main`, push direct `origin main`. Pas de worktree/branche.

## Déploiement (résumé, détails dans documentation.md)

VPS OVH `146.59.233.252`, derrière NPM, domaine `ganprevoyance.messagingme.app` :
- racine `/` → `ganprev-app:3000` (dashboard Docker)
- `/webhook` + `/health` → `172.18.0.1:8130` (bot PM2)
