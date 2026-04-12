-- ── 002_add_review_metadata.sql ───────────────────────────────────────────────
-- Add metadata fields to track correctness and confidence as per Codex schema

-- Add to individual file reviews
ALTER TABLE file_reviews 
  ADD COLUMN IF NOT EXISTS overall_correctness TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score     REAL;

-- Add to the overall job review
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS overall_confidence_score REAL;

-- Add an index for searching by correctness if needed
CREATE INDEX IF NOT EXISTS file_reviews_correctness_idx ON file_reviews (overall_correctness);
