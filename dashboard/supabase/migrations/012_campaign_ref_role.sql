-- 012_campaign_ref_role.sql — Rôles structurés sur les refs d'une campagne
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- À partir de la Phase 25, une campagne EDH a 3 catégories de briques :
--
--   - `launch`  : event de LANCEMENT, au plus 1 par campagne, optionnel.
--                 Doit être un event porteur de tel (`text_label` non vide)
--                 — c'est cet event qui sert au calcul du coût Meta.
--                 Validation côté API uniquement (pas de FK trans-table en SQL).
--   - `body`    : briques du FUNNEL drag-and-drop. C'est ce qu'on voit
--                 dans la palette du builder de campagne. Multi-sélection
--                 sans limite.
--   - `failed`  : event signalant les échecs d'envoi WhatsApp, au plus 1
--                 par campagne, optionnel. Son count est soustrait du
--                 lancement pour le calcul des envois réussis.
--
-- Les campagnes existantes (Phase 20-24) ont toutes leurs refs en role
-- 'body' par défaut (DEFAULT 'body') — elles continuent à fonctionner
-- avec leur builder en mode body-only.

BEGIN;

ALTER TABLE campaign_refs
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'body';

ALTER TABLE campaign_refs
  DROP CONSTRAINT IF EXISTS campaign_refs_role_chk;
ALTER TABLE campaign_refs
  ADD CONSTRAINT campaign_refs_role_chk
  CHECK (role IN ('launch','body','failed'));

-- Index uniques partiels : au plus une ref par campagne avec role=launch
-- et idem pour role=failed. Les body n'ont pas de limite.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_refs_one_launch
  ON campaign_refs (campaign_id)
  WHERE role = 'launch';
CREATE UNIQUE INDEX IF NOT EXISTS campaign_refs_one_failed
  ON campaign_refs (campaign_id)
  WHERE role = 'failed';

COMMIT;
