CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id          TEXT        NOT NULL,
  owner                    TEXT        NOT NULL,
  repo                     TEXT        NOT NULL,
  pr_number                INTEGER     NOT NULL,
  pr_title                 TEXT,
  pr_author                TEXT,
  commit_sha               TEXT        NOT NULL,
  base_sha                 TEXT        NOT NULL,
  trigger                  TEXT        NOT NULL CHECK (trigger IN ('auto', 'mention', 'retry')),
  status                   TEXT        NOT NULL DEFAULT 'queued'
                                        CHECK (status IN ('queued', 'running', 'done', 'failed', 'superseded')),
  config_snapshot          JSONB,
  check_run_id             BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at               TIMESTAMPTZ,
  finished_at              TIMESTAMPTZ,
  total_input_tokens       INTEGER     DEFAULT 0,
  total_output_tokens      INTEGER     DEFAULT 0,
  verdict                  TEXT        CHECK (verdict IN ('approve', 'comment')),
  file_count               INTEGER     DEFAULT 0,
  comment_count            INTEGER     DEFAULT 0,
  error_msg                TEXT,
  head_ref                 TEXT,
  base_ref                 TEXT,
  summary_markdown         TEXT,
  review_id                BIGINT,
  retry_of_job_id          UUID        REFERENCES jobs(id) ON DELETE SET NULL,
  summary_model            TEXT,
  steps                    JSONB       DEFAULT '[]'::jsonb,
  overall_confidence_score REAL,
  overall_correctness      TEXT
);

CREATE INDEX IF NOT EXISTS jobs_repo_idx ON jobs (owner, repo, pr_number);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_head_sha_idx ON jobs (owner, repo, pr_number, commit_sha, trigger);
CREATE INDEX IF NOT EXISTS jobs_correctness_idx ON jobs (overall_correctness);

CREATE TABLE IF NOT EXISTS file_reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_path           TEXT        NOT NULL,
  file_status         TEXT        NOT NULL CHECK (file_status IN ('pending', 'done', 'skipped', 'failed')),
  model_used          TEXT        NOT NULL,
  model_provider      TEXT,
  diff_line_count     INTEGER,
  diff_input          TEXT,
  raw_ai_output       TEXT,
  parsed_comments     JSONB,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  duration_ms         INTEGER,
  verdict             TEXT        CHECK (verdict IN ('approve', 'comment')),
  file_summary        TEXT,
  overall_correctness TEXT,
  confidence_score    REAL,
  error_msg           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_reviews_job_idx ON file_reviews (job_id);
CREATE INDEX IF NOT EXISTS file_reviews_correctness_idx ON file_reviews (overall_correctness);
CREATE INDEX IF NOT EXISTS file_reviews_provider_idx ON file_reviews (model_provider);

CREATE TABLE IF NOT EXISTS repo_configs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id TEXT        NOT NULL,
  owner           TEXT        NOT NULL,
  repo            TEXT        NOT NULL,
  raw_yaml        TEXT,
  parsed_json     JSONB,
  config_missing  BOOLEAN     DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  main_model      TEXT,
  fallback_models JSONB       DEFAULT '[]'::jsonb,
  size_overrides  JSONB,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE (owner, repo)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id TEXT        NOT NULL UNIQUE,
  event_name  TEXT        NOT NULL,
  owner       TEXT,
  repo        TEXT,
  payload     JSONB       NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_repo_idx ON webhook_deliveries (owner, repo, received_at DESC);

CREATE TABLE IF NOT EXISTS model_configs (
  model_id   TEXT PRIMARY KEY,
  rpm        INTEGER NOT NULL,
  tpm        INTEGER NOT NULL,
  rpd        INTEGER NOT NULL,
  provider   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider)
VALUES
  ('gemma-3-27b', 30, 15000, 14400, 'google'),
  ('gemini-2.5-flash', 5, 250000, 20, 'google'),
  ('gemini-3-flash', 5, 250000, 20, 'google'),
  ('gemma-4-31b-it', 15, 1000000, 1500, 'google')
ON CONFLICT (model_id) DO UPDATE SET
  rpm = EXCLUDED.rpm,
  tpm = EXCLUDED.tpm,
  rpd = EXCLUDED.rpd,
  provider = EXCLUDED.provider,
  updated_at = now();
