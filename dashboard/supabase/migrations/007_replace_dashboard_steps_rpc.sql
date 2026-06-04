-- 007_replace_dashboard_steps_rpc.sql
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Atomic replace of all steps + refs of a dashboard.
--
-- Both EDH and Auxerre apps used to do `DELETE FROM dashboard_steps WHERE
-- dashboard_id = X` + N sequential `INSERT`s in JS without a transaction.
-- A failure mid-loop left the dashboard with fewer steps than intended.
--
-- This RPC bundles the whole replace inside a single PL/pgSQL function so
-- Postgres autotransactions it: any error (FK violation, type mismatch,
-- network blip during the call) rolls back the whole change. The dashboard
-- is either entirely the new state or entirely the old state — never
-- a partial mix.
--
-- Caller responsibilities (still done in app code, NOT here):
--   - Authentication / ownership check (created_by + school_slug)
--   - Validation of step count, ref count, event_ns existence
--   - Update of dashboards.updated_at (kept separate so the caller can
--     still update name/date_preset/etc. in the same client roundtrip)
--
-- Argument shape :
--   p_dashboard_id : uuid of the dashboard (caller validates ownership)
--   p_steps        : jsonb array, each element :
--     {
--       "label": "..." | null,
--       "refs": [
--         { "step_type": "mm_event",  "event_ns": "..." }
--         | { "step_type": "url_click", "redirect_event_id": "uuid" }
--       ]
--     }
--
-- Returns : void (success = no exception). On error, RAISE EXCEPTION
-- propagates to the caller as a Postgres error visible via the Supabase
-- client.

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
  -- Tout le bloc est implicitement transactionnel cote PG : si on RAISE
  -- ou si une contrainte explose, tout est rollback.

  IF jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'p_steps doit etre un array jsonb';
  END IF;

  -- Wipe les steps existants (cascade -> dashboard_step_refs)
  DELETE FROM dashboard_steps WHERE dashboard_id = p_dashboard_id;

  -- Reinsert dans l'ordre du JSON
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
        step_id, ref_position, step_type, event_ns, redirect_event_id
      ) VALUES (
        v_step_id,
        v_ref_position,
        v_ref->>'step_type',
        v_ref->>'event_ns',
        CASE
          WHEN v_ref ? 'redirect_event_id' AND v_ref->>'redirect_event_id' IS NOT NULL
          THEN (v_ref->>'redirect_event_id')::uuid
          ELSE NULL
        END
      );
      v_ref_position := v_ref_position + 1;
    END LOOP;

    v_step_position := v_step_position + 1;
  END LOOP;
END;
$$;

-- Permissions : autoriser le service_role (utilise par les apps) a appeler.
-- Authenticated/anon ne peuvent pas l'appeler (l'app force passage par
-- service_role cote serveur, jamais cote client).
REVOKE ALL ON FUNCTION public.replace_dashboard_steps(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_dashboard_steps(uuid, jsonb) TO service_role;
