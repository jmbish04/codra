CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Jobs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id     TEXT        NOT NULL,
  owner               TEXT        NOT NULL,
  repo                TEXT        NOT NULL,
  pr_number           INTEGER     NOT NULL,
  pr_title            TEXT,
  pr_author           TEXT,
  commit_sha          TEXT        NOT NULL,
  base_sha            TEXT        NOT NULL,
  trigger             TEXT        NOT NULL CHECK (trigger IN ('auto', 'mention', 'retry')),
  status              TEXT        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued', 'running', 'done', 'failed', 'superseded')),
  config_snapshot     JSONB,
  check_run_id        BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  total_input_tokens  INTEGER     DEFAULT 0,
  total_output_tokens INTEGER     DEFAULT 0,
  verdict             TEXT        CHECK (verdict IN ('approve', 'comment')),
  file_count          INTEGER     DEFAULT 0,
  comment_count       INTEGER     DEFAULT 0,
  error_msg           TEXT,
  head_ref            TEXT,
  base_ref            TEXT,
  summary_markdown    TEXT,
  review_id           BIGINT,
  retry_of_job_id     UUID        REFERENCES jobs(id) ON DELETE SET NULL,
  summary_model       TEXT,
  steps               JSONB       DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS jobs_repo_idx     ON jobs (owner, repo, pr_number);
CREATE INDEX IF NOT EXISTS jobs_status_idx   ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_created_idx  ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_head_sha_idx ON jobs (owner, repo, pr_number, commit_sha, trigger);

-- ── File reviews ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_path       TEXT        NOT NULL,
  file_status     TEXT        NOT NULL CHECK (file_status IN ('pending', 'done', 'skipped', 'failed')),
  model_used      TEXT        NOT NULL,
  diff_line_count INTEGER,
  diff_input      TEXT,
  raw_ai_output   TEXT,
  parsed_comments JSONB,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  verdict         TEXT        CHECK (verdict IN ('approve', 'comment')),
  file_summary    TEXT,
  error_msg       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_reviews_job_idx ON file_reviews (job_id);

-- ── Repo configs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repo_configs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id TEXT        NOT NULL,
  owner           TEXT        NOT NULL,
  repo            TEXT        NOT NULL,
  raw_yaml        TEXT,
  parsed_json     JSONB,
  config_missing  BOOLEAN     DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner, repo)
);

-- ── Webhook deliveries ────────────────────────────────────────────────────────
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
