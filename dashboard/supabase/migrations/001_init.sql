-- 001_init.sql — EDH Stats schema
-- Apply via: Supabase SQL Editor → paste this whole file → Run.

-- Users (login UI)
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Redirect events (one tracked URL per row)
CREATE TABLE IF NOT EXISTS redirect_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_redirect_events_school_archived
  ON redirect_events (school_slug, archived_at);

-- Redirect versions (destination history)
CREATE TABLE IF NOT EXISTS redirect_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES redirect_events(id) ON DELETE CASCADE,
  destination_url text NOT NULL,
  version         int NOT NULL,
  active_from     timestamptz NOT NULL DEFAULT now(),
  active_to       timestamptz
);

-- Only one active version per event (enforced)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_redirect_versions_active
  ON redirect_versions (event_id) WHERE active_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_redirect_versions_event
  ON redirect_versions (event_id, version);

-- Clicks (one row per click)
CREATE TABLE IF NOT EXISTS clicks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES redirect_events(id) ON DELETE CASCADE,
  version_id  uuid NOT NULL REFERENCES redirect_versions(id) ON DELETE CASCADE,
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  ip          inet,
  user_agent  text,
  referer     text,
  country     text
);

CREATE INDEX IF NOT EXISTS idx_clicks_event_clicked_at
  ON clicks (event_id, clicked_at);

CREATE INDEX IF NOT EXISTS idx_clicks_version
  ON clicks (version_id);

-- Messagingme custom events cache
CREATE TABLE IF NOT EXISTS mm_events (
  school_slug    text NOT NULL,
  event_ns       text NOT NULL,
  name           text NOT NULL,
  description    text,
  text_label     text,
  price_label    text,
  number_label   text,
  last_synced_at timestamptz,
  PRIMARY KEY (school_slug, event_ns)
);

-- Messagingme occurrences (one row per occurrence)
CREATE TABLE IF NOT EXISTS mm_occurrences (
  id            bigint NOT NULL,
  school_slug   text NOT NULL,
  event_ns      text NOT NULL,
  user_ns       text,
  text_value    text,
  price_value   numeric,
  number_value  numeric,
  occurred_at   timestamptz NOT NULL,
  PRIMARY KEY (school_slug, id),
  FOREIGN KEY (school_slug, event_ns) REFERENCES mm_events(school_slug, event_ns) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mm_occurrences_school_event_occurred
  ON mm_occurrences (school_slug, event_ns, occurred_at);

-- Sync state per (school, event) — incremental watermark
CREATE TABLE IF NOT EXISTS mm_sync_state (
  school_slug         text NOT NULL,
  event_ns            text NOT NULL,
  last_occurrence_id  bigint,
  last_run_at         timestamptz,
  last_run_status     text,
  last_run_error      text,
  PRIMARY KEY (school_slug, event_ns)
);
