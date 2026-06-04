# WIP — Gan Prévoyance

Travail en cours. Quand une entrée est terminée → `features.md` ou supprimée.

## Dashboard — DÉPLOYÉ ET EN LIGNE
- [x] Clone Neoma → `dashboard/`, rebrand Gan Prévoyance (slug `gan-prev`, cookies
      `ganprev_*`, logo OFFICIEL récupéré, métadonnées, env `MM_TOKEN_GANPREV`/`OPENAI_VS_GANPREV`).
- [x] **Sync custom events corrigé** (curseur `start_id` croissant, cap 100, pas de
      break, watermark = max id inséré) + tests réécrits. Build OK.
- [x] Vector store OpenAI créé → `OPENAI_VS_GANPREV=vs_6a21dabc7df881919fb6c4413fa688b1`.
- [x] Admin `julien@messagingme.fr` seedé (school_slug `gan-prev`, mdp Jaus650dl+).
- [x] **Déployé Docker `ganprev-app` sur le VPS + NPM racine + cert LE (id 21) + HTTPS forcé.**
      → https://ganprevoyance.messagingme.app/login (HTTP 200, cron sync 22:00 actif).

## Bot — DÉPLOYÉ, fonctionnel SAUF clé Gemini
- [x] Scaffold complet, agent Gemini 2.5, 2 outils (KB + escalade), garde-fou anti-hallu.
- [x] Schéma appliqué sur `etmdddhgikihybjufqwq` (pooler `aws-1-eu-central-1`, direct IPv6 KO).
- [x] Scrape ganprevoyance.fr : **167 pages, 1129 chunks** (fix UA navigateur + <form> WebForms).
- [x] **1129 chunks vectorisés** (e5-base 768-dim). Retrieval OK.
- [x] **Déployé PM2 `ganprevoyance` (172.18.0.1:8130) + NPM `/webhook` `/health`.**
      → https://ganprevoyance.messagingme.app/health = {"ok":true}. Token MM valide (999/1000).
- [ ] ⛔ **BLOCAGE : clé Gemini expirée** (réutilisée d'Odalys). Fournir une clé
      Gemini fraîche → maj `bot/.env` (local + VPS) `GEMINI_API_KEY` → `pm2 restart ganprevoyance`.
- [ ] Brancher le webhook dans le flow MessagingMe (291825) → POST
      `https://ganprevoyance.messagingme.app/webhook`, en-tête `X-Webhook-Secret:
      a2f320961912be19215714321dc47389e280bba3b2a380e0`, body `{external_id, message}`.
- [ ] Optionnel : node MM d'escalade conseiller → `MM_HELP_NODE_NS`.

## Points ouverts
- Logo dashboard : vrai logo officiel récupéré depuis ganprevoyance.fr (OK).
- Bot et dashboard ont 2 bases de connaissance distinctes (bot = pgvector scrapé ;
  dashboard = vector store OpenAI). Unification possible plus tard.
- Re-scrape périodique du site à prévoir (cron) pour garder la KB du bot à jour.
