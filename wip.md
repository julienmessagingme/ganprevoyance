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

### Escalade conseiller — CÂBLÉE
- [x] Node de transfert `MM_HELP_NODE_NS=f266213n450294737` (confirme la transmission au conseiller).
- [x] À l'escalade, l'agent génère un **résumé factuel de la conversation** et l'écrit
      dans le user field `MM_SUMMARY_FIELD_NS=f266213v13539241` ("reponses client IA")
      via `PUT set-user-field` (par var_ns), puis déclenche le node. Pas de double message.
- [x] FAQ "Relevé de situation" ajoutée à la KB (6 chunks). Ingestion docx réutilisable
      (`npm run ingest-docx -- "<chemin.docx>"` puis `npm run embed`).

### ✅ BOT EN PRODUCTION (NO_SEND=0, ouvert à tous)
- Le bot répond aux vrais clients WhatsApp (workspace 291825). `/health` OK.
- Garde-fou dispo si besoin de re-restreindre : `SEND_ALLOWLIST=<user_ns,...>` dans
  `bot/.env` (ne répond qu'à ces contacts) ; `NO_SEND=1` pour couper tout envoi.
- Clé Gemini `AQ.…` : fonctionne (le cerveau disait à tort qu'elle expirait, cf.
  LEARNINGS 2026-06-05). On ne swappe que si elle 401 à l'usage.
- [ ] Surveiller une vraie escalade (résumé écrit dans le field + node déclenché) :
      si le flow du contact diffère (f265919) du flow du node/field (f266213), scope
      MM à vérifier.
- [ ] Enrichir les cas de tests (gestion, délais, prestations, SRC, réclamations).

## Onglet "Base de connaissance" = gestionnaire de la KB du bot (FAIT, OpenAI sorti)
- [x] L'onglet **affiche et édite la VRAIE KB du bot** (`kb_chunks` pgvector) : site
      scrapé (167 pages), documents (PDF), entrées manuelles. Source unique.
- [x] Bot : endpoints `/kb/list`, `/kb/get`, `/kb/upsert`, `/kb/delete` (par url ou
      sourceId). Dashboard : `bot-kb.ts` + route `/api/knowledge/kb` + nouveau
      `knowledge-client.tsx` (liste, voir/éditer, supprimer, ajouter).
- [x] **OpenAI entièrement retiré** : module `openai-kb.ts`, `lib/knowledge/`, anciennes
      routes `api/knowledge/*` supprimés ; vector store `vs_6a21...` supprimé côté OpenAI.
- [x] Testé E2E via le dashboard : liste = 168 sources (167 site + 1 doc) ; créer →
      atterrit dans `kb_chunks` embeddé ; supprimer → retiré.
- [ ] Fichiers PDF/Word uploadés DIRECTEMENT dans l'onglet : l'ajout passe par le champ
      texte (copier-coller) ; un vrai upload de fichier avec extraction auto reste à
      ajouter si besoin (aujourd'hui : `npm run ingest-docx` côté bot pour les .docx).
- Vars `OPENAI_*` encore présentes dans les .env mais plus utilisées (nettoyage cosmétique possible).

## Points ouverts
- Re-scrape périodique du site à prévoir (cron) pour garder la KB du bot à jour.
- Connexion bot DB via pooler eu-central-1 (le direct IPv6 ne passe pas).
