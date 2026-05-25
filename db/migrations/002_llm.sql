ALTER TABLE jobs ADD COLUMN IF NOT EXISTS check_run_completed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recovery_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_queue_message_at TIMESTAMPTZ;
ALTER TABLE file_reviews ADD COLUMN IF NOT EXISTS transient_error_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_lease_expiry_idx
  ON jobs (lease_expires_at)
  WHERE status = 'running' AND lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_terminal_check_idx
  ON jobs (status, check_run_completed_at)
  WHERE check_run_id IS NOT NULL AND check_run_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS jobs_unleased_running_idx
  ON jobs (last_queue_message_at, heartbeat_at)
  WHERE status = 'running' AND lease_expires_at IS NULL;

DELETE FROM file_reviews fr
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY job_id, file_path ORDER BY created_at ASC, id ASC) AS row_number
  FROM file_reviews
) ranked
WHERE fr.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS file_reviews_job_file_path_key
  ON file_reviews (job_id, file_path);

CREATE TABLE IF NOT EXISTS llm_providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL UNIQUE,
  api_format        TEXT        NOT NULL CHECK (api_format IN ('openai', 'anthropic', 'gemini', 'cloudflare-workers-ai')),
  base_url          TEXT,
  encrypted_api_key TEXT,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPDATE llm_providers
SET name = 'Cloudflare', updated_at = now()
WHERE name = 'Cloudflare Workers AI';

UPDATE llm_providers
SET name = 'Google', updated_at = now()
WHERE name = 'Google Gemini';

INSERT INTO llm_providers (name, api_format, base_url, enabled)
VALUES
  ('Cloudflare', 'cloudflare-workers-ai', NULL, TRUE),
  ('Google', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', FALSE),
  ('OpenAI', 'openai', 'https://api.openai.com/v1', FALSE),
  ('Anthropic', 'anthropic', 'https://api.anthropic.com/v1', FALSE),
  ('OpenRouter', 'openai', 'https://openrouter.ai/api/v1', FALSE)
ON CONFLICT (name) DO UPDATE SET
  api_format = EXCLUDED.api_format,
  base_url = EXCLUDED.base_url,
  updated_at = now();

ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS provider_id UUID;
ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS model_name TEXT;

UPDATE model_configs mc
SET
  provider_id = provider_record.id,
  model_name = COALESCE(mc.model_name, mc.model_id)
FROM llm_providers provider_record
WHERE mc.provider_id IS NULL
  AND (
    (mc.provider = 'cloudflare' AND provider_record.name = 'Cloudflare')
    OR (mc.provider = 'gemini' AND provider_record.name = 'Google')
    OR (mc.provider = 'google' AND provider_record.name = 'Google')
    OR (mc.provider = 'openai' AND provider_record.name = 'OpenAI')
    OR (mc.provider = 'anthropic' AND provider_record.name = 'Anthropic')
  );

UPDATE model_configs
SET model_name = model_id
WHERE model_name IS NULL;

INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider, provider_id, model_name, updated_at)
SELECT '@cf/moonshotai/kimi-k2.6', 10, 131072, 300, 'cloudflare', p.id, '@cf/moonshotai/kimi-k2.6', now()
FROM llm_providers p
WHERE p.name = 'Cloudflare'
ON CONFLICT (model_id) DO UPDATE SET
  rpm = EXCLUDED.rpm,
  tpm = EXCLUDED.tpm,
  rpd = EXCLUDED.rpd,
  provider = EXCLUDED.provider,
  provider_id = EXCLUDED.provider_id,
  model_name = EXCLUDED.model_name,
  updated_at = now();

INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider, provider_id, model_name, updated_at)
SELECT '@cf/zai-org/glm-4.7-flash', 20, 131072, 600, 'cloudflare', p.id, '@cf/zai-org/glm-4.7-flash', now()
FROM llm_providers p
WHERE p.name = 'Cloudflare'
ON CONFLICT (model_id) DO UPDATE SET
  rpm = EXCLUDED.rpm,
  tpm = EXCLUDED.tpm,
  rpd = EXCLUDED.rpd,
  provider = EXCLUDED.provider,
  provider_id = EXCLUDED.provider_id,
  model_name = EXCLUDED.model_name,
  updated_at = now();

INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider, provider_id, model_name, updated_at)
SELECT 'gemma-4-31b-it', 15, 1000000, 1500, 'gemini', p.id, 'gemma-4-31b-it', now()
FROM llm_providers p
WHERE p.name = 'Google'
ON CONFLICT (model_id) DO UPDATE SET
  provider = EXCLUDED.provider,
  provider_id = EXCLUDED.provider_id,
  model_name = EXCLUDED.model_name,
  updated_at = now();

INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider, provider_id, model_name, updated_at)
SELECT 'gemma-4-26b-a4b-it', 30, 1000000, 1500, 'gemini', p.id, 'gemma-4-26b-a4b-it', now()
FROM llm_providers p
WHERE p.name = 'Google'
ON CONFLICT (model_id) DO UPDATE SET
  provider = EXCLUDED.provider,
  provider_id = EXCLUDED.provider_id,
  model_name = EXCLUDED.model_name,
  updated_at = now();

ALTER TABLE model_configs ALTER COLUMN provider_id SET NOT NULL;
ALTER TABLE model_configs ALTER COLUMN model_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_configs_provider_id_fkey'
  ) THEN
    ALTER TABLE model_configs
      ADD CONSTRAINT model_configs_provider_id_fkey
      FOREIGN KEY (provider_id) REFERENCES llm_providers(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS model_configs_provider_id_idx ON model_configs (provider_id);
