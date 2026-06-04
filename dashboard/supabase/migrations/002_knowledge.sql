-- 002_knowledge.sql — Knowledge Base module
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- 3 tables, all scoped by school_slug :
--   knowledge_themes      themes per school
--   knowledge_subthemes   subthemes per school, optionally linked to a theme
--   knowledge_items       uploaded items (file / text / qa) referencing OpenAI
--
-- Note on order : themes + subthemes first because knowledge_items has FKs
-- to both. Postgres allows forward FKs in DDL but it's clearer this way.

-- Themes (scoped per school, unique name within a school)
CREATE TABLE IF NOT EXISTS knowledge_themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_slug, name)
);

-- Subthemes (scoped per school, optionally linked to a theme).
-- A subtheme without a theme is a free-floating subtheme.
CREATE TABLE IF NOT EXISTS knowledge_subthemes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug text NOT NULL,
  theme_id    uuid REFERENCES knowledge_themes(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_slug, name)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_subthemes_theme
  ON knowledge_subthemes (theme_id);

-- Items (one per uploaded file / text / Q&A pair)
CREATE TABLE IF NOT EXISTS knowledge_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_slug           text NOT NULL,
  type                  text NOT NULL,
  file_name             text NOT NULL,
  title                 text,
  question              text,
  answer                text,
  theme_id              uuid REFERENCES knowledge_themes(id) ON DELETE SET NULL,
  subtheme_id           uuid REFERENCES knowledge_subthemes(id) ON DELETE SET NULL,
  vector_store_file_id  text NOT NULL,
  openai_file_id        text NOT NULL,
  status                text,
  uploaded_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_items_type_chk CHECK (type IN ('file', 'text', 'qa'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_school_uploaded_at
  ON knowledge_items (school_slug, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_school_type
  ON knowledge_items (school_slug, type);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_theme
  ON knowledge_items (theme_id) WHERE theme_id IS NOT NULL;

-- French full-text search on questions and answers (used by the history
-- search box). The combined index uses concatenation to match both at once.
CREATE INDEX IF NOT EXISTS idx_knowledge_items_search_qa
  ON knowledge_items USING gin (
    to_tsvector(
      'french',
      coalesce(question, '') || ' ' || coalesce(answer, '') || ' ' ||
      coalesce(title, '') || ' ' || coalesce(file_name, '')
    )
  );
