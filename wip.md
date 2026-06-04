# WIP — Gan Prévoyance

Travail en cours. Quand une entrée est terminée → `features.md` ou supprimée.

## Dashboard
- [x] Clone Neoma → `dashboard/`, rebrand Gan Prévoyance (slug `gan-prev`, cookies
      `ganprev_*`, logos, métadonnées, env vars `MM_TOKEN_GANPREV`/`OPENAI_VS_GANPREV`).
- [x] **Sync custom events corrigé** (curseur `start_id` croissant, cap 100, pas de
      break, watermark = max id inséré) + tests réécrits. Build OK.
- [ ] Logo : `public/logos/ganprev.png` est un **placeholder** (copie Neoma). À
      remplacer par le vrai logo Gan Prévoyance.
- [ ] Créer le vector store OpenAI Gan Prévoyance → `OPENAI_VS_GANPREV`.
- [ ] Seed admin `julien@messagingme.fr` (school_slug `gan-prev`) dans la base
      partagée : `cd dashboard && npm run seed:users`.
- [ ] Déploiement Docker sur le VPS + NPM racine + DNS Cloudflare.

## Bot
- [x] Scaffold complet (`server`, `agent`, `search`, `mmclient`, `db`, embeddings,
      `scrape`, `embed`, `setup-db`, `chat-cli`). Tous les fichiers parsent.
- [x] Agent Gemini 2.5, 2 outils (recherche KB + escalade), garde-fou anti-hallucination.
- [ ] `npm install` dans `bot/`.
- [ ] `npm run setup-db` (applique le schéma sur `etmdddhgikihybjufqwq`). Vérifier
      que la connexion directe IPv6 passe, sinon renseigner `SUPABASE_DB_HOST` (pooler).
- [ ] `npm run scrape` ganprevoyance.fr → ajuster les sélecteurs cheerio selon la
      structure réelle du site (à valider après le 1er run).
- [ ] `npm run embed` (vectorisation).
- [ ] Test local `npm run chat` puis déploiement PM2 + NPM `/webhook` `/health`.
- [ ] Configurer le webhook côté flow MessagingMe (291825) vers `/webhook` +
      en-tête `X-Webhook-Secret`. Optionnel : node MM d'escalade → `MM_HELP_NODE_NS`.

## Points ouverts
- Base du bot : projet Supabase **dédié** `etmdddhgikihybjufqwq` (choix validé).
- Le bot et le dashboard ont deux bases de connaissance distinctes (bot = pgvector
  local scrapé ; dashboard = vector store OpenAI). Unification possible plus tard.
