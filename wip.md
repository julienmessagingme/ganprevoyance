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

## Bot — DÉPLOYÉ ET FONCTIONNEL (clé Gemini OK)
- [x] Scaffold complet, **agent Gemini 2.5 conforme** (orienter sans décider, mention
      IA en dur au 1er tour, script mécontentement, escalade sur demande seulement).
- [x] **RAG déterministe** : recherche KB en dur + injection dans le system (Gemini
      n'appelle pas l'outil de façon fiable). Réponses générales bien fondées sur la KB.
- [x] Schéma sur `etmdddhgikihybjufqwq` (pooler `aws-1-eu-central-1`, direct IPv6 KO).
- [x] Scrape ganprevoyance.fr : **167 pages, 1129 chunks vectorisés** (e5-base 768-dim).
- [x] Clé Gemini valide en place (format AQ.* récent). Tests conformité OK en local + prod.
- [x] **Déployé PM2 `ganprevoyance` (172.18.0.1:8130) + NPM `/webhook` `/health`.**
      → /health OK, smoke test webhook public OK (agent répond, RAG rows=5). Token MM 997/1000.
- [x] Le flow MessagingMe (291825) **est déjà branché** sur le webhook (vrai user vu).

### ⚠️ Reste pour le bot
- [ ] **Node d'escalade conseiller** (`_gan_agent_talk`) : Julien doit fournir le
      `node_ns` → le mettre dans `bot/.env` `MM_HELP_NODE_NS` + `pm2 restart`. Tant
      que ce n'est pas fait, l'agent ANNONCE la mise en relation mais ne déclenche
      aucun transfert réel.
- [ ] **Validation conformité** du nouveau discours avant diffusion large (Marguerite
      avait demandé de couper l'ancien). Le nouveau respecte les exigences (orienter
      sans décider, mention IA, mécontentement cadré), à faire valider.
- [ ] Enrichir les cas de tests (gestion, délais, prestations, SRC, réclamations).

## Points ouverts
- Bot et dashboard ont 2 bases de connaissance distinctes (bot = pgvector scrapé ;
  dashboard = vector store OpenAI `vs_6a21...`). Unification possible plus tard.
- Re-scrape périodique du site à prévoir (cron) pour garder la KB du bot à jour.
- Connexion bot DB via pooler eu-central-1 (le direct IPv6 ne passe pas).
