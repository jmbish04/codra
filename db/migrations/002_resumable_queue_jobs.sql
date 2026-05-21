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
