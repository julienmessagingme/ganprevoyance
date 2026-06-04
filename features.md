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
- **Base de connaissance** — alimenter le vector store OpenAI (PDF, texte, Q/R,
  Excel), organisé par thèmes. Statut : live (vector store Gan Prévoyance à créer).
- **Admin** — inviter / désactiver des utilisateurs. Statut : live.

## Bot WhatsApp (assurance)

Répond automatiquement aux questions des clients/prospects sur WhatsApp via
l'agent IA Gemini 2.5, à partir de la base de connaissance Gan Prévoyance.

- **Réponses fondées sur la base de connaissance** — l'agent cherche dans le
  contenu officiel (FAQ + pages produits/garanties scrapées de ganprevoyance.fr)
  et répond en s'appuyant uniquement dessus. Statut : en cours de mise en place.
- **Garde-fou assurance** — n'invente jamais montants, garanties, délais ; pour
  tout cas personnel (contrat, sinistre, données) ou incertain, propose la mise en
  relation avec un conseiller. Statut : intégré.
- **Escalade conseiller** — bascule vers un conseiller humain à la demande ou quand
  la question dépasse la base de connaissance. Statut : intégré (node MM à brancher).
