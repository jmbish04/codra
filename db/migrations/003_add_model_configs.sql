-- ── 003_add_model_configs.sql ───────────────────────────────────────────────
-- Add model configuration table for rate limits and update repo_configs

CREATE TABLE IF NOT EXISTS model_configs (
  model_id TEXT PRIMARY KEY,
  rpm INTEGER NOT NULL,
  tpm INTEGER NOT NULL,
  rpd INTEGER NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert defaults for the free tier as requested
-- RPM: Requests Per Minute, TPM: Tokens Per Minute, RPD: Requests Per Day
-- TPM of -1 or very large means Unlimited
INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider) VALUES
('gemma-3-27b', 30, 15000, 14400, 'google'),
('gemini-2.5-flash', 5, 250000, 20, 'google'),
('gemini-3-flash', 5, 250000, 20, 'google'),
('gemma-4-31b-it', 15, 1000000, 1500, 'google'); -- Using 1M for 'Unlimited' TPM, and google as it's in gemma.ts

-- Note: @cf/zai-org/glm-4.7-flash is Cloudflare and doesn't need rate limits in our DB
-- but we can add it with 0 or -1 if we want to manage it.
-- For now, we'll only add those that need tracking.

-- Add model selection columns to repo_configs for structured access
-- and to fulfill "add these details to the db as well"
ALTER TABLE repo_configs
  ADD COLUMN IF NOT EXISTS main_model TEXT,
  ADD COLUMN IF NOT EXISTS fallback_model TEXT,
  ADD COLUMN IF NOT EXISTS size_overrides JSONB;

-- Set defaults for existing repos
UPDATE repo_configs SET main_model = 'gemma-4-31b-it' WHERE main_model IS NULL;
