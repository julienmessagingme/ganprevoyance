-- 009_campaigns.sql — Campagnes (regroupements d'events MM + URLs trackées)
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Une "campagne" est un regroupement nommé d'events mm + URLs trackées,
-- attaché à une école (ou au scope 'edh' groupe). Sert de FILTRE de palette
-- dans le module "Mes tableaux" : quand l'utilisateur crée un tableau, il
-- peut choisir une campagne pour ne voir, à gauche, que les briques de
-- cette campagne au lieu de tout le catalogue de l'école.
--
-- Visibilité :
--   - `is_shared = false` (défaut) : seul `created_by` voit la campagne
--   - `is_shared = true`           : tous les users ayant accès à l'école
--                                    voient et utilisent la campagne ;
--                                    seul `created_by` (ou un admin) peut
--                                    l'éditer ou la supprimer.
--
-- Scope école :
--   - `school_slug` parmi les 9 écoles EDH OU `'edh'` (scope groupe).
--     Validation déléguée à l'app via `isValidScopeSlug` ; pas de CHECK
--     en DB (cohérent avec `dashboards.school_slug`).
--
-- Refs : même schéma que `dashboard_step_refs` (mm_event ou url_click,
-- avec `event_school_slug` renseigné en mode EDH pour porter l'origine
-- de l'event_ns non globalement unique). Pas d'index UNIQUE sur la
-- combinaison (campaign_id, ref) — on tolère qu'un user ajoute deux
-- fois la même brique, à lui de l'éviter via l'UI.
--
-- No RLS — service-role server-side, ownership/visibilité enforcés en code.

BEGIN;

CREATE TABLE IF NOT EXISTS campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_shared   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index combiné couvrant les 2 requêtes typiques :
--   - "mes campagnes pour l'école courante"      (created_by + school_slug)
--   - "campagnes partagées pour l'école courante" (school_slug + is_shared)
CREATE INDEX IF NOT EXISTS idx_campaigns_school_user
  ON campaigns (school_slug, created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_school_shared
  ON campaigns (school_slug, is_shared)
  WHERE is_shared = true;

CREATE TABLE IF NOT EXISTS campaign_refs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position          int  NOT NULL,
  step_type         text NOT NULL CHECK (step_type IN ('mm_event','url_click')),
  event_ns          text,
  redirect_event_id uuid REFERENCES redirect_events(id) ON DELETE CASCADE,
  event_school_slug text,
  CONSTRAINT campaign_refs_one_ref CHECK (
    (step_type = 'mm_event'  AND event_ns IS NOT NULL AND redirect_event_id IS NULL)
 OR (step_type = 'url_click' AND event_ns IS NULL    AND redirect_event_id IS NOT NULL)
  ),
  -- url_click : redirect_event_id est déjà un uuid global → event_school_slug
  -- doit rester NULL. Pour mm_event, NULL en mode école-précise (legacy)
  -- ou renseigné en mode EDH (groupe).
  CONSTRAINT campaign_refs_event_school_slug_chk CHECK (
    step_type <> 'url_click' OR event_school_slug IS NULL
  ),
  UNIQUE (campaign_id, position)
);

CREATE INDEX IF NOT EXISTS idx_campaign_refs_campaign
  ON campaign_refs (campaign_id, position);

COMMIT;
