-- TMC_PATCH35C2_GIFT_LIFECYCLE: gift trial lifecycle columns
-- Run in Supabase SQL Editor BEFORE deploying Patch 35c-2.
-- Idempotent: IF NOT EXISTS, so re-running is safe.

-- Tracks which reminder emails were sent for the CURRENT trial.
-- Comma-separated list of milestones: '5d', '1d', '0d'.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_reminders_sent TEXT NULL DEFAULT '';

-- When the gift trial actually expired (set by the cron at downgrade).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_expired_at TIMESTAMPTZ NULL;

-- Lets contact.html show a "trial ended" message: marks a tag whose
-- owner's gift trial lapsed (vs an admin-disabled tag).
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_expired BOOLEAN NOT NULL DEFAULT FALSE;

-- Verify:
-- SELECT column_name FROM information_schema.columns
--   WHERE (table_name='users' AND column_name IN ('gift_reminders_sent','gift_expired_at'))
--      OR (table_name='tags'  AND column_name='gift_expired');
