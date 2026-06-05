# WIP — Gan Prévoyance

Projet **LIVE** : dashboard + bot en production. Archi détaillée dans `documentation.md`,
vue produit dans `features.md`. Ce fichier ne garde que le travail en cours / à surveiller.

## En cours / à surveiller
- **Validation conformité** du discours du bot (process Gan Prévoyance / Groupe). Le
  discours respecte les exigences (orienter sans décider, mention IA en dur, mécontentement
  cadré sans reconnaissance de faute, escalade + résumé conseiller) — reste à faire valider.
- **Escalade, scope de flow** : surveiller une vraie escalade en prod. Le node de transfert
  + le user field résumé sont en flow `f266213` ; si un contact arrive d'un autre flow
  (`f265919`), vérifier que `set-user-field`/`send-node` matchent bien (gotcha scope MM).
- **Fraîcheur KB** : re-scrape périodique de ganprevoyance.fr à planifier (cron) pour que
  le bot reste à jour avec le site.

## Backlog proche (voir aussi todo.md)
- Upload direct de fichiers PDF/Word dans l'onglet Base de connaissance (extraction auto).
  Aujourd'hui : copier-coller le texte dans l'onglet, ou `npm run ingest-docx` (côté bot) pour les .docx.
- Cleanup cosmétique : retirer les vars `OPENAI_*` des `.env` (plus utilisées, OpenAI sorti).
- Enrichir les cas de tests conformité (gestion, délais, prestations, SRC, réclamations).
