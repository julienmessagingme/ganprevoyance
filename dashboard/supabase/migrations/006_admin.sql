-- 006_admin.sql — Admin tab : flags is_admin + soft-delete + accès par école
-- Apply via: Supabase SQL Editor → paste this whole file → Run.
--
-- Ajoute trois colonnes à `users` :
--   is_admin       : flag d'admin (visibilité du tab Admin + droits CRUD users)
--   deactivated_at : soft-delete (l'user ne peut plus se logger, dashboards préservés)
--   last_login_at  : audit "qui s'est connecté quand"
--
-- Ajoute la table `user_school_access` qui contrôle quelles écoles sont
-- visibles par chaque user. Backfill : tous les users existants gardent
-- accès aux 9 écoles (compatibilité ascendante avant que l'admin restreigne).
--
-- Promotion de Julien à admin via UPDATE.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_active_email
  ON users (email) WHERE deactivated_at IS NULL;

CREATE TABLE IF NOT EXISTS user_school_access (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_slug text NOT NULL,
  PRIMARY KEY (user_id, school_slug)
);

-- Backfill : tous les users existants ont accès aux 9 écoles
INSERT INTO user_school_access (user_id, school_slug)
SELECT u.id, s
FROM users u
CROSS JOIN unnest(ARRAY['efap','3wa','brassart','cesine','efj','esec','ecole-bleue','icart','ifa']) AS s
ON CONFLICT DO NOTHING;

-- Julien promu admin (à adapter à l'email réel en DB)
UPDATE users SET is_admin = true WHERE email = 'julien@messagingme.fr';

COMMIT;
