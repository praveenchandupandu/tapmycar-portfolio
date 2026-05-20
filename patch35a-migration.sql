-- TMC_PATCH35A_GIFT_ACTIVATE: gift activate columns
--
-- Run this in Supabase SQL Editor BEFORE deploying Patch 35a's backend.
-- Idempotent: uses IF NOT EXISTS so re-running is safe.

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_plan TEXT NULL
    CHECK (gift_plan IS NULL OR gift_plan IN ('standard', 'premium'));

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_months INT NULL
    CHECK (gift_months IS NULL OR (gift_months >= 1 AND gift_months <= 12));

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_assigned_to_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_note TEXT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_plan_expires_at TIMESTAMPTZ NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_plan_starts_at TIMESTAMPTZ NULL;

-- Useful index for the daily expiry cron (Patch 35c)
CREATE INDEX IF NOT EXISTS idx_users_gift_expiry
  ON users (gift_plan_expires_at)
  WHERE gift_plan_expires_at IS NOT NULL;

-- Useful index for looking up gift-ready tags
CREATE INDEX IF NOT EXISTS idx_tags_is_gift
  ON tags (is_gift)
  WHERE is_gift = TRUE;

-- Verify migration:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'tags' AND column_name LIKE 'gift%' OR column_name = 'is_gift';
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name LIKE 'gift%';
