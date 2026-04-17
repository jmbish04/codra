-- ── 006_update_fallback_models.sql ───────────────────────────────────────────────
-- Update fallback_model to be a JSONB array of fallback models
-- and ensure the enabled column is used.

ALTER TABLE repo_configs
  DROP COLUMN IF EXISTS fallback_model;

ALTER TABLE repo_configs
  ADD COLUMN IF NOT EXISTS fallback_models JSONB DEFAULT '[]'::jsonb;
