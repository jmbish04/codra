-- ── 005_add_repo_enabled.sql ───────────────────────────────────────────────
-- Add enabled toggle to repo_configs to allow disabling code review per repo

ALTER TABLE repo_configs
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
