# Documentation technique — Gan Prévoyance

Un repo (`julienmessagingme/ganprevoyance`, **public**), deux services sur
`ganprevoyance.messagingme.app`. Workspace MessagingMe **291825**.

## 1. Dashboard (`dashboard/`)

Cloné de **Neoma** (lui-même clone d'EDH), rebrandé Gan Prévoyance, avec le
**sync custom events corrigé**.

### Stack
- Next.js 15.5 (App Router, `output: standalone`), React 19, TypeScript.
- Tailwind v4 + shadcn ; recharts / visx ; @dnd-kit ; html-to-image + jspdf (export PDF).
- Auth maison : JWT HS256 (`jose`) en cookie `ganprev_session`, bcrypt.
- Supabase via `@supabase/supabase-js` (service-role, server-side). ⚠️ Toujours `await`
  les mutations (un `void` non awaité ne déclenche jamais la requête, cf. LEARNINGS 2026-06-05).
- Base de connaissance : l'onglet PILOTE la KB du **bot** (pgvector) via l'API bot `/kb/*`
  (lib `src/lib/bot-kb.ts`). **Plus d'OpenAI.**
- Landing : `/` redirige vers `/knowledge`.
- `node-cron` (sync quotidien 22:00 Europe/Paris) dans `instrumentation.ts`.

### Base de données (partagée EDH/Neoma `odmpeakltuzwvtydbpfu`)
Isolation par `school_slug='gan-prev'`. Tables clés (schéma EDH existant, aucune
migration ajoutée) : `users`, `user_school_access`, `redirect_events`,
`redirect_versions`, `clicks`, `mm_events`, `mm_occurrences`, `mm_sync_state`,
`dashboards`, `dashboard_steps`, `campaigns`, `campaign_refs`, `knowledge_*`.

### Sync custom events MessagingMe (corrigé)
`src/lib/messagingme/client.ts` + `sync.ts`.
- `listEvents` : catalogue `/flow/custom-events` (page-based, OK).
- `iterOccurrences` : données `/flow/custom-events/data` par **curseur `start_id`
  croissant** (exclusif), `limit=100` (cap dur), arrêt sur page < limit. **Aucun
  break précoce.** Watermark `mm_sync_state.last_occurrence_id` = max id inséré.
  Upsert idempotent sur PK `(school_slug, id)`. Corrige le bug Neoma (LEARNINGS
  2026-06-02 : l'API renvoie les occurrences par id CROISSANT, pas descendant).

### Variables d'env (`dashboard/.env.local`, gitignored)
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`,
`INTERNAL_API_KEY`, `MESSAGINGME_API_BASE`, `MM_TOKEN_GANPREV` (token workspace 291825),
`BOT_KB_URL` (ex. `http://172.18.0.1:8130`) + `BOT_KB_SECRET` (= `WEBHOOK_SECRET` du bot,
pour piloter la KB du bot depuis l'onglet), `CRON_TIMEZONE`, `PUBLIC_BASE_URL`,
`DISABLE_CRON`, `SEED_JULIEN_PASSWORD`. (Les `OPENAI_*` ne sont plus utilisées : module retiré.)

### Config client (à un seul endroit)
`src/lib/schools.ts` : `SCHOOLS = [{ slug:'gan-prev', name:'Gan Prévoyance',
tokenEnv:'MM_TOKEN_GANPREV', vectorStoreEnv:'OPENAI_VS_GANPREV', logo:'/logos/ganprev.png' }]`.

### Déploiement (Docker)
- `docker-compose.yml` : service `ganprev-app`, image `ganprev-app:latest`,
  `expose: 3000`, réseau externe `mcp-robot_default` (NPM l'atteint par le nom).
- VPS : `git pull` du repo puis `cd dashboard && docker compose up -d --build`.
- NPM : proxy host `ganprevoyance.messagingme.app`, racine → `http://ganprev-app:3000`,
  SSL Let's Encrypt.

### Base de connaissance (onglet → KB du bot)
L'onglet "Base de connaissance" est un **gestionnaire de la KB du bot** (table `kb_chunks`
pgvector du projet bot), source UNIQUE. OpenAI/vector store entièrement retiré.
- `src/lib/bot-kb.ts` + route `src/app/api/knowledge/kb/route.ts` (GET liste/`?q=` recherche,
  GET `?url=` contenu, POST upsert, DELETE) → appellent l'API du bot `/kb/*`.
- UI `src/app/(app)/knowledge/knowledge-client.tsx` : liste des sources (site scrapé /
  document / manuel), recherche plein-texte (debounce), voir/éditer, supprimer, ajouter.
- L'onglet "Analyse conversation" (`/analyse-conversation`) : écran découverte ConvAnalyzer
  + vidéo démo (`public/convanalyzer-demo.html` en iframe), pas un vrai accès.

## 2. Bot WhatsApp (`bot/`)

Inspiré d'**Odalys**, adapté à l'assurance (Q&A texte, pas de cartes), Gemini 2.5.

### Stack
- Node ESM. `openai` (couche OpenAI-compat Gemini), `pg`, `@xenova/transformers`
  (e5-base local, 768-dim), `cheerio` (scraping).
- LLM : `gemini-2.5-flash` via `https://generativelanguage.googleapis.com/v1beta/openai/`.
  Provider switchable (`LLM_PROVIDER`).

### Fichiers
- `server.mjs` — webhook HTTP (port 8130). ACK 200 immédiat + traitement en fond, gate
  de concurrence, délai conversations longues. **API KB `/kb/list|get|upsert|delete`**
  (auth `X-Webhook-Secret`). `SEND_ALLOWLIST` restreint les envois (test sans diffuser).
- `agent.mjs` — agent **conforme** : system prompt assurance (oriente sans décider),
  **mention IA en dur au 1er message IA ou nouvelle session** (gap > `SESSION_GAP_HOURS`),
  **RAG DÉTERMINISTE** (recherche KB injectée dans le system, PAS via un outil), 1 seul
  outil `demander_conseiller` (escalade → génère un résumé conv + déclenche le node),
  garde-fous code (détection contrat précis / réclamation), sérialisation par user, historique borné.
- `kb-ingest.mjs` — chunk + embed e5 + upsert/delete/list/get sur `kb_chunks` (utilisé par l'API `/kb/*`).
- `ingest-docx.mjs` — ingère un `.docx` (mammoth) dans la KB (`npm run ingest-docx -- "<path>"`).
- `search.mjs` — recherche sémantique pgvector sur `kb_chunks`.
- `db.mjs` — pool `pg` (connexion directe `db.<ref>` ou pooler via overrides env).
- `mmclient.mjs` — client MM : rate-limit piloté par headers UChat (1000/h), `sendText`,
  escalade conseiller (écrit le résumé conv dans le user field par `var_ns` via
  `set-user-field`, PUIS déclenche le node de transfert), handoff.
- `embedder.mjs` / `embedder-worker.mjs` — embeddings e5-base en worker thread.
- `scrape.mjs` — scrape ganprevoyance.fr (sitemap ou crawl) → `kb_chunks`.
- `embed.mjs` — vectorise les chunks. `setup-db.mjs` — applique `schema.sql`.
- `chat-cli.mjs` — REPL de test local.

### Base de données (projet Supabase dédié `etmdddhgikihybjufqwq`)
Connexion Postgres **directe** (`pg`), pgvector. Tables : `kb_chunks`
(url, title, section, kind, chunk_index, content, embedding vector(768)),
`conversations` (external_id, messages jsonb, turns). Fonction `match_kb`.
> Le MCP Supabase n'a pas accès à ce projet (autre org) → setup via `setup-db.mjs`.

### Variables d'env (`bot/.env`, gitignored)
`SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SECRET_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_HOST`/`_USER`/`_PORT` (pooler `aws-1-eu-central-1`,
le direct IPv6 ne passe pas), `LLM_PROVIDER`, `LLM_MODEL`, `GEMINI_API_KEY`,
`WEBHOOK_SECRET` (= `BOT_KB_SECRET` côté dashboard), `PORT` (8130), `HOST` (VPS: 172.18.0.1),
`MM_API_BASE`, `MM_API_TOKEN`, `MM_HELP_NODE_NS` (f266213n450294737),
`MM_SUMMARY_FIELD_NS` (f266213v13539241), `SESSION_GAP_HOURS` (re-affichage mention IA),
`MAX_CONCURRENCY`, `SEND_ALLOWLIST` (test : ne répondre qu'à ces user_ns), `NO_SEND`
(0 = prod, 1 = muet).

### Déploiement (PM2)
- VPS : `git pull` puis `cd bot && npm install && pm2 restart ganprevoyance --update-env`
  (1er lancement : `pm2 start server.mjs --name ganprevoyance`). `.env` avec
  `HOST=172.18.0.1`.
- NPM : sur le proxy host `ganprevoyance.messagingme.app`, locations `/webhook` et
  `/health` → `http://172.18.0.1:8130`.
- Webhook MM : le flow du workspace 291825 pointe déjà sur
  `https://ganprevoyance.messagingme.app/webhook` (en-tête `X-Webhook-Secret`).
  **Bot EN PROD** (`NO_SEND=0`, ouvert à tous).

## Patterns hérités (cf. brain/LEARNINGS.md)
- Transactions DB courtes : aucune connexion tenue pendant un appel LLM.
- Tool-calling fiable = garde-fous code (détection + re-prompt), pas forçage
  `tool_choice` (inutilisable côté Gemini).
- Rate-limit MM 1000/h/token piloté par les headers `x-ratelimit-*`.
- Gemini OpenAI-compat : cache implicite actif (−75% sur le préfixe stable).
