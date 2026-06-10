# Features — Gan Prévoyance

Vue produit (côté utilisateur). Détails techniques dans `documentation.md`.

## Dashboard de pilotage

Accès sur `https://ganprevoyance.messagingme.app/` (login email + mot de passe).

- **URLs trackées** — créer des liens courts redirigés (slug → URL de destination),
  compter les clics, garder l'historique des destinations. Statut : live.
- **Stats** — volumétrie journalière des custom events MessagingMe + clics par URL,
  sélecteur de période (7 / 30 / 90 jours / Tout). Statut : live.
- **Mes tableaux** — construire ses propres tableaux à partir des custom events et
  des URLs : funnels (étapes cumulables, drag-and-drop) ou camemberts, partageables,
  export PDF. Statut : live.
- **Campagnes** — regrouper des events/URLs sous une campagne nommée (rôles
  lancement / corps / échec, coût Meta WhatsApp). Statut : live.
- **Base de connaissance** (page d'accueil de l'app) — voir, **rechercher** (plein texte),
  éditer et supprimer tout le contenu utilisé par le bot : pages du site scrapé, documents
  importés, entrées manuelles (Q/R, texte). Ce qui est ici alimente directement les
  réponses du bot. Statut : live.
- **Analyse de conversations** — écran de découverte de ConvAnalyzer (présentation + vidéo
  démo) ; accès complet sur demande à l'administrateur. Statut : teaser.
- **Admin** — inviter / désactiver des utilisateurs, gérer les domaines accessibles.
  Statut : live.

## Bot WhatsApp (assurance)

Répond automatiquement aux questions des clients/prospects sur WhatsApp via l'agent IA
Gemini 2.5, à partir de la base de connaissance Gan Prévoyance. **En production.**

- **Mention IA** — au 1er message, le bot annonce clairement qu'il est une IA (vocation
  informative, ne remplace pas un conseiller). Statut : live.
- **Réponses fondées sur la base de connaissance** — répond à partir du contenu officiel
  (site + documents) géré depuis l'onglet Base de connaissance. Statut : live.
- **Garde-fou assurance** — oriente sans décider, n'invente jamais montants/garanties/
  délais ; pour tout cas personnel (contrat, sinistre) ou réclamation, propose un
  conseiller (sans reconnaître de faute ni s'engager). Statut : live.
- **Escalade conseiller** — sur demande du client (ou son acceptation), met en relation
  avec un conseiller et transmet un **résumé de la conversation** au conseiller. Le résumé
  est **filtré RGPD** (aucune donnée de santé/sensible). Statut : live.
- **Détection de mécontentement** — un indice de frustration est calculé en continu ;
  au-delà d'un seuil, une alerte (node MM) est déclenchée automatiquement. Statut : live.
- **Confidentialité** — les conversations sont purgées après 30 jours d'inactivité.
