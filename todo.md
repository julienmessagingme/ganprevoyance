# TODO — Gan Prévoyance

Backlog (idées validées non commencées, bugs connus, améliorations). Ce qui est
en cours est dans `wip.md`.

## Priorité
- Faire valider le discours du bot par la conformité avant communication large.
- Upload direct de fichiers PDF/Word dans l'onglet Base de connaissance (extraction
  texte côté dashboard + push vers la KB du bot). Aujourd'hui : copier-coller le texte,
  ou `npm run ingest-docx` côté bot pour les .docx.

## Améliorations
- Mécontentement : option d'**auto-escalade conseiller** au seuil (aujourd'hui : juste le node).
- Vue **"conversations à risque"** dans le dashboard à partir de `discontent_score` (matrice sentiment).
- Re-scrape périodique automatique de ganprevoyance.fr (cron) pour garder la KB du bot à jour.
- Page "santé" du sync custom events dans le dashboard (dernier run, volumétrie par event).
- Throttle/handoff bot : configurer `MM_OVERFLOW_NODE_NS` si le budget MM se tend.
- Cleanup : retirer les vars `OPENAI_*` des `.env` (plus utilisées, module OpenAI retiré).

## Connu / à surveiller
- Sync custom events : Neoma (et EDH) ont encore le bug de pagination descendante
  (LEARNINGS 2026-06-02) — corrigé ICI seulement. À reporter dans leurs repos.
- Escalade : node/field en flow `f266213` ; surveiller le cas d'un contact d'un autre
  flow (`f265919`) → scope MM des user-fields.
- Connexion bot DB : direct IPv6 KO, on passe par le pooler `aws-1-eu-central-1`
  (overrides `SUPABASE_DB_HOST`/`_USER`/`_PORT`).
