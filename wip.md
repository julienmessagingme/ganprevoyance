# WIP — Gan Prévoyance

Projet **LIVE** : dashboard + bot en production. Archi détaillée dans `documentation.md`,
vue produit dans `features.md`. Ce fichier ne garde que le travail en cours / à surveiller.

## Fait récemment (depuis le dernier sync)
- Résumé conseiller filtré RGPD (sans données de santé), reformulation fidèle sans prise
  de parti, plus de closing creux, acceptation ("ok merci") reconnue.
- Indice de mécontentement (score lissé → node `f266213n450834377` au seuil 65, 1×).
- Purge RGPD des conversations à 30 j (boot + 1×/jour). Recherche KB hybride.
- Entrée KB Service client (09 69 32 35 05). Node escalade → `f266213n450294757`.

## En cours / à surveiller
- **Validation conformité** du discours du bot (process Gan Prévoyance / Groupe) — reste à faire valider.
- **Escalade, scope de flow** : surveiller une vraie escalade en prod. Node + user field en
  flow `f266213` ; si un contact arrive d'un autre flow (`f265919`), vérifier que
  `set-user-field`/`send-node` matchent (gotcha scope MM).
- **Seuil mécontentement** : ajuster `DISCONTENT_THRESHOLD` à l'usage si trop/pas assez sensible.
- **Fraîcheur KB** : re-scrape périodique de ganprevoyance.fr à planifier (cron).

## Backlog proche (voir aussi todo.md)
- Upload direct de fichiers PDF/Word dans l'onglet Base de connaissance (extraction auto).
  Aujourd'hui : copier-coller le texte dans l'onglet, ou `npm run ingest-docx` (côté bot) pour les .docx.
- Cleanup cosmétique : retirer les vars `OPENAI_*` des `.env` (plus utilisées, OpenAI sorti).
- Enrichir les cas de tests conformité (gestion, délais, prestations, SRC, réclamations).
