-- 010_dashboard_campaign_link.sql — 1 campagne ↔ 1 tableau lié
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- À partir de la Phase 21, chaque campagne possède son propre tableau
-- (funnel) géré sur la page `/campaigns/[id]`. Le tableau et la campagne
-- sont créés ensemble côté POST /api/campaigns ; supprimer la campagne
-- supprime aussi son tableau (CASCADE).
--
-- - `dashboards.campaign_id` : NULL = tableau libre (visible dans
--   "Mes tableaux"), non-NULL = tableau d'une campagne (visible
--   uniquement via la page de la campagne, exclu de "Mes tableaux").
-- - Index UNIQUE partiel : un dashboard ne peut être lié qu'à une seule
--   campagne, mais on peut avoir plein de dashboards avec campaign_id NULL
--   (les tableaux libres).
-- - ON DELETE CASCADE : supprimer la campagne supprime aussi le tableau
--   et toutes ses étapes (chaîne de CASCADE déjà en place sur dashboards).
--
-- Aucun backfill nécessaire : les dashboards et campagnes existants
-- restent indépendants. Les campagnes créées avant Phase 21 n'ont pas
-- de tableau associé — Julien devra les recréer (peu de cas en prod
-- au moment du déploiement).

BEGIN;

ALTER TABLE dashboards
  ADD COLUMN IF NOT EXISTS campaign_id uuid
    REFERENCES campaigns(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_campaign_id
  ON dashboards (campaign_id)
  WHERE campaign_id IS NOT NULL;

COMMIT;
