-- ── 004_add_model_provider.sql ───────────────────────────────────────────────
-- Add model_provider column to file_reviews to track whether Cloudflare or Google was used

ALTER TABLE file_reviews 
  ADD COLUMN IF NOT EXISTS model_provider TEXT;

-- Index for analytics and filtering
CREATE INDEX IF NOT EXISTS file_reviews_provider_idx ON file_reviews (model_provider);

-- Backfill existing reviews based on model_used prefixes
UPDATE file_reviews 
  SET model_provider = 'cloudflare' 
  WHERE model_used LIKE '@cf/%' AND model_provider IS NULL;

UPDATE file_reviews 
  SET model_provider = 'google' 
  WHERE model_used NOT LIKE '@cf/%' AND model_provider IS NULL;
