-- 005_dashboard_step_refs.sql — Multi-refs par step (cumul)
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Restructure dashboard_steps : un step n'a plus une seule ref (event_ns OU
-- redirect_event_id) mais une LISTE de refs stockées dans une sous-table
-- dashboard_step_refs. Le volume du step = somme des volumes de ses refs.
--
-- Variante data-preserving : on crée d'abord la sous-table, on copie chaque
-- ref existante (1 par step) à ref_position = 0, puis on supprime les
-- colonnes et la contrainte obsolètes de dashboard_steps. Tout en
-- transaction : si une étape échoue, rien n'est appliqué.

BEGIN;

-- 1. Ajouter le label optionnel sur dashboard_steps (NULL = fallback "A + B + C" côté UI)
ALTER TABLE dashboard_steps
  ADD COLUMN IF NOT EXISTS label text;

-- 2. Créer la sous-table refs avant de copier les données
CREATE TABLE IF NOT EXISTS dashboard_step_refs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id           uuid NOT NULL REFERENCES dashboard_steps(id) ON DELETE CASCADE,
  ref_position      int  NOT NULL,
  step_type         text NOT NULL CHECK (step_type IN ('mm_event','url_click')),
  event_ns          text,
  redirect_event_id uuid REFERENCES redirect_events(id) ON DELETE CASCADE,
  CONSTRAINT dashboard_step_refs_one_ref CHECK (
    (step_type = 'mm_event'  AND event_ns IS NOT NULL AND redirect_event_id IS NULL)
 OR (step_type = 'url_click' AND event_ns IS NULL    AND redirect_event_id IS NOT NULL)
  ),
  UNIQUE (step_id, ref_position)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_step_refs_step
  ON dashboard_step_refs (step_id, ref_position);

-- 3. Backfill : chaque step existant a exactement une ref → on la copie à ref_position 0.
--    On utilise un WHERE pour ignorer les éventuels rows déjà migrés (idempotence).
INSERT INTO dashboard_step_refs (step_id, ref_position, step_type, event_ns, redirect_event_id)
SELECT s.id, 0, s.step_type, s.event_ns, s.redirect_event_id
FROM dashboard_steps s
WHERE NOT EXISTS (
  SELECT 1 FROM dashboard_step_refs r WHERE r.step_id = s.id
)
AND s.step_type IS NOT NULL;

-- 4. Drop des colonnes/contrainte obsolètes sur dashboard_steps
ALTER TABLE dashboard_steps
  DROP CONSTRAINT IF EXISTS dashboard_steps_one_ref;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS step_type;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS event_ns;
ALTER TABLE dashboard_steps DROP COLUMN IF EXISTS redirect_event_id;

COMMIT;
