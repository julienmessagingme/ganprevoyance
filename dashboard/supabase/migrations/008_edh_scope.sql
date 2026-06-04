-- 008_edh_scope.sql — Scope EDH (groupe) pour Stats & Mes tableaux
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Introduit un "scope" virtuel `'edh'` à côté des 9 écoles, pour que
-- certains utilisateurs (Julien, Laura, Sarah au moment de l'écriture)
-- voient une vue agrégée toutes écoles confondues sur :
--   - Stats : volumétrie par (école, custom event) et par (école, URL trackée)
--   - Mes tableaux : funnels avec étapes pouvant cumuler des refs venues
--     de plusieurs écoles
--
-- Convention :
--   - L'accès EDH est stocké comme une row supplémentaire dans
--     `user_school_access` avec `school_slug = 'edh'` (sentinelle).
--   - Les dashboards en mode EDH sont stockés avec
--     `dashboards.school_slug = 'edh'`.
--   - Les refs de step pointant vers un mm_event en mode EDH portent
--     l'école d'origine via la nouvelle colonne `event_school_slug`,
--     car `event_ns` n'est pas globalement unique entre écoles.
--   - En mode school-scoped (legacy), `event_school_slug` est NULL et
--     le code se rabat sur `dashboards.school_slug`.
--
-- Aucun backfill nécessaire : les dashboards school-scoped existants
-- continuent de fonctionner avec event_school_slug=NULL.

BEGIN;

ALTER TABLE dashboard_step_refs
  ADD COLUMN IF NOT EXISTS event_school_slug text;

-- Garde-fou : pour les refs de type mm_event, soit event_school_slug est
-- NULL (legacy school-scoped), soit il est renseigné (mode EDH). Pour
-- les refs url_click on n'utilise pas cette colonne (redirect_event_id
-- est déjà un uuid global).
ALTER TABLE dashboard_step_refs
  DROP CONSTRAINT IF EXISTS dashboard_step_refs_event_school_slug_chk;
ALTER TABLE dashboard_step_refs
  ADD CONSTRAINT dashboard_step_refs_event_school_slug_chk CHECK (
    step_type <> 'url_click' OR event_school_slug IS NULL
  );

-- Mise à jour de la RPC replace_dashboard_steps pour qu'elle persiste
-- event_school_slug, indispensable au mode EDH (sinon les refs mm_event
-- en mode EDH perdent l'origine).
CREATE OR REPLACE FUNCTION public.replace_dashboard_steps(
  p_dashboard_id uuid,
  p_steps jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_step jsonb;
  v_ref jsonb;
  v_step_id uuid;
  v_step_position int := 0;
  v_ref_position int;
BEGIN
  IF jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'p_steps doit etre un array jsonb';
  END IF;

  DELETE FROM dashboard_steps WHERE dashboard_id = p_dashboard_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    INSERT INTO dashboard_steps (dashboard_id, position, label)
    VALUES (
      p_dashboard_id,
      v_step_position,
      NULLIF(v_step->>'label', '')
    )
    RETURNING id INTO v_step_id;

    IF jsonb_typeof(v_step->'refs') <> 'array' THEN
      RAISE EXCEPTION 'step % : refs doit etre un array', v_step_position;
    END IF;

    v_ref_position := 0;
    FOR v_ref IN SELECT * FROM jsonb_array_elements(v_step->'refs')
    LOOP
      INSERT INTO dashboard_step_refs (
        step_id, ref_position, step_type, event_ns, redirect_event_id, event_school_slug
      ) VALUES (
        v_step_id,
        v_ref_position,
        v_ref->>'step_type',
        v_ref->>'event_ns',
        CASE
          WHEN v_ref ? 'redirect_event_id' AND v_ref->>'redirect_event_id' IS NOT NULL
          THEN (v_ref->>'redirect_event_id')::uuid
          ELSE NULL
        END,
        NULLIF(v_ref->>'event_school_slug', '')
      );
      v_ref_position := v_ref_position + 1;
    END LOOP;

    v_step_position := v_step_position + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_dashboard_steps(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_dashboard_steps(uuid, jsonb) TO service_role;

COMMIT;
