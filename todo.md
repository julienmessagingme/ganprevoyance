# TODO — Gan Prévoyance

Backlog (idées validées non commencées, bugs connus, améliorations). Ce qui est
en cours est dans `wip.md`.

## Priorité
- Remplacer le logo placeholder par le vrai logo Gan Prévoyance (dashboard).
- Valider la qualité du scraping ganprevoyance.fr (couverture FAQ + produits) et
  affiner les sélecteurs / le découpage en chunks après le 1er run.
- Brancher le webhook MessagingMe (291825) et tester une vraie conversation WhatsApp.

## Améliorations
- Unifier les deux bases de connaissance (le bot pourrait lire la KB gérée depuis
  le module dashboard plutôt qu'un scraping séparé) → autonomie client.
- Node MessagingMe d'escalade vers conseiller (carte web-callback) → `MM_HELP_NODE_NS`.
- Recherche hybride bot (trigram + embedding) si des questions à mots-clés/typos
  ressortent mal en pur sémantique.
- Page "santé" du sync dans le dashboard (dernier run, volumétrie par event).
- Throttle/handoff bot : configurer `MM_OVERFLOW_NODE_NS` si le budget MM se tend.

## Connu / à surveiller
- Sync custom events : Neoma (et EDH) ont encore le bug de pagination descendante
  (LEARNINGS 2026-06-02) — corrigé ICI seulement. À reporter dans leurs repos.
- Connexion Postgres directe IPv6 sur le nouveau projet Supabase : si le VPS ou la
  machine locale ne l'a pas, basculer sur le pooler (overrides `SUPABASE_DB_*`).
