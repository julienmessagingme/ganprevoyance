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
- **Bot assurance = garde-fou anti-hallucination** : l'agent ne répond QUE depuis
  la base de connaissance (`rechercher_kb`), n'invente jamais montants/garanties/
  délais, et escalade (`demander_conseiller`) pour tout cas personnel ou incertain.
- **Bot DB** : projet Supabase dédié `etmdddhgikihybjufqwq`, connexion Postgres
  directe (`pg`) + pgvector. Pas le MCP Supabase (autre org).
- **Git** : tout sur `main`, push direct `origin main`. Pas de worktree/branche.

## Déploiement (résumé, détails dans documentation.md)

VPS OVH `146.59.233.252`, derrière NPM, domaine `ganprevoyance.messagingme.app` :
- racine `/` → `ganprev-app:3000` (dashboard Docker)
- `/webhook` + `/health` → `172.18.0.1:8130` (bot PM2)
