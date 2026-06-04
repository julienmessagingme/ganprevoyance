-- 013_dashboard_is_shared.sql — Partage des tableaux dans Mes tableaux
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Aligne `dashboards` sur `campaigns` côté visibilité : un tableau peut
-- être PRIVÉ (par défaut, visible uniquement par son auteur) ou PARTAGÉ
-- (visible par tous les utilisateurs qui ont accès à l'école, modifiable
-- uniquement par l'auteur ou un admin — règle enforcée côté API).
--
-- Tous les dashboards existants basculent en `is_shared=false` via le
-- DEFAULT — comportement strictement inchangé pour eux jusqu'à ce que
-- leur auteur active le toggle dans le builder.
--
-- Ne concerne que les tableaux libres de « Mes tableaux ». Les tableaux
-- liés à une campagne (`campaign_id IS NOT NULL`) héritent de la
-- visibilité de leur campagne (cf. `campaigns.is_shared`) ; le flag
-- `dashboards.is_shared` est ignoré pour eux côté API.

BEGIN;

ALTER TABLE dashboards
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Index partiel pour la requête « tableaux partagés visibles dans cette
-- école » (analogue à `idx_campaigns_school_shared` de la migration 009).
CREATE INDEX IF NOT EXISTS idx_dashboards_school_shared
  ON dashboards (school_slug, is_shared)
  WHERE is_shared = true AND campaign_id IS NULL;

COMMIT;
