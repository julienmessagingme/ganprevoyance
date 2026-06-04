-- 004_dashboards.sql — Custom dashboards module ("Mes tableaux")
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Two tables, scoped per-school + per-user :
--   dashboards         the report definition (name, type, date range)
--   dashboard_steps    ordered steps inside a funnel, referencing either a
--                      mm_event (event_ns) or a redirect_event (uuid)
--
-- V1 : the only `type` allowed is 'funnel'. The CHECK is widened in
-- a future migration when other report types arrive.
--
-- No RLS — the app uses the service-role server-side and enforces
-- ownership (created_by = me AND school_slug = currentSchool) in code.

CREATE TABLE IF NOT EXISTS dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'funnel'
              CHECK (type IN ('funnel')),
  date_preset text NOT NULL DEFAULT '30d'
              CHECK (date_preset IN ('7d','30d','90d','custom')),
  date_from   date,
  date_to     date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboards_user_school
  ON dashboards (created_by, school_slug, updated_at DESC);

-- Steps : one row per ordered step. Discriminator `step_type` decides
-- which of (event_ns, redirect_event_id) is set ; the CHECK enforces
-- that exactly one is non-null.
--
-- mm_event : refers to mm_events(school_slug, event_ns) but we don't
-- declare the FK because mm_events can be deleted/recreated by
-- messagingme without us cascading — the UI grays out the step when
-- the source is gone.
--
-- url_click : FK to redirect_events(id) with ON DELETE CASCADE so the
-- step disappears if the URL is deleted.
CREATE TABLE IF NOT EXISTS dashboard_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id      uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  position          int  NOT NULL,
  step_type         text NOT NULL CHECK (step_type IN ('mm_event','url_click')),
  event_ns          text,
  redirect_event_id uuid REFERENCES redirect_events(id) ON DELETE CASCADE,
  CONSTRAINT dashboard_steps_one_ref CHECK (
    (step_type = 'mm_event'  AND event_ns IS NOT NULL AND redirect_event_id IS NULL)
 OR (step_type = 'url_click' AND event_ns IS NULL    AND redirect_event_id IS NOT NULL)
  ),
  UNIQUE (dashboard_id, position)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_steps_dashboard
  ON dashboard_steps (dashboard_id, position);
