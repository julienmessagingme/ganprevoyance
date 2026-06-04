-- 011_dashboard_type_pie.sql — Pie chart en plus du funnel
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Étend la contrainte CHECK de `dashboards.type` pour accepter 'pie' en
-- plus de 'funnel'. Les tableaux pie réutilisent les mêmes tables
-- `dashboard_steps` + `dashboard_step_refs` (chaque "step" devient une
-- "part" du pie, peut cumuler plusieurs refs comme un funnel).
--
-- Différences :
--   - Funnel : ordre des étapes important (axe X), volumes décroissants.
--   - Pie    : ordre = ordre des légendes/couleurs, volumes affichés en
--              % base 100 du total + valeurs absolues.
--
-- Aucun backfill nécessaire : les dashboards existants restent en 'funnel'.

BEGIN;

ALTER TABLE dashboards
  DROP CONSTRAINT IF EXISTS dashboards_type_check;

ALTER TABLE dashboards
  ADD CONSTRAINT dashboards_type_check
  CHECK (type IN ('funnel','pie'));

COMMIT;
