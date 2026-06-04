-- 003_rename_ejf_to_efj.sql — rename school slug 'ejf' → 'efj' everywhere.
--
-- Why : the school's official name is EFJ (École Française de Journalisme),
-- not EJF. The original migration shipped with the wrong slug ; this one
-- migrates the existing data to match the corrected SCHOOLS constant.
--
-- The composite FK on mm_occurrences(school_slug, event_ns) → mm_events
-- prevents updating mm_events.school_slug while there are still rows in
-- mm_occurrences referencing the old value, so we drop it for the
-- duration of the rename and re-add it identically.
--
-- knowledge_items, knowledge_themes, knowledge_subthemes only hold
-- school_slug as a discriminator (no composite FK), so they can be
-- updated freely.
--
-- Apply via Supabase SQL Editor as a single block. All wrapped in a
-- transaction so a partial failure leaves the DB untouched.

BEGIN;

-- 1. Drop the composite FK temporarily.
ALTER TABLE mm_occurrences
  DROP CONSTRAINT IF EXISTS mm_occurrences_school_slug_event_ns_fkey;

-- 2. Rename the slug across every table that holds it.
UPDATE mm_events           SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE mm_occurrences      SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE mm_sync_state       SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE redirect_events     SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE knowledge_items     SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE knowledge_themes    SET school_slug = 'efj' WHERE school_slug = 'ejf';
UPDATE knowledge_subthemes SET school_slug = 'efj' WHERE school_slug = 'ejf';

-- 3. Re-create the FK identically to migration 001.
ALTER TABLE mm_occurrences
  ADD CONSTRAINT mm_occurrences_school_slug_event_ns_fkey
  FOREIGN KEY (school_slug, event_ns)
  REFERENCES mm_events(school_slug, event_ns)
  ON DELETE CASCADE;

COMMIT;

-- Verify (run separately if you want to confirm) :
--   SELECT 'mm_events'           AS t, school_slug, count(*) FROM mm_events           WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'mm_occurrences',  school_slug, count(*) FROM mm_occurrences      WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'mm_sync_state',   school_slug, count(*) FROM mm_sync_state       WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'redirect_events', school_slug, count(*) FROM redirect_events     WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'knowledge_items', school_slug, count(*) FROM knowledge_items     WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'knowledge_themes',school_slug, count(*) FROM knowledge_themes    WHERE school_slug IN ('ejf','efj') GROUP BY school_slug
--   UNION ALL SELECT 'knowledge_subthemes',school_slug,count(*) FROM knowledge_subthemes WHERE school_slug IN ('ejf','efj') GROUP BY school_slug;
-- Expected : zero rows with 'ejf', any rows that existed should now be 'efj'.
