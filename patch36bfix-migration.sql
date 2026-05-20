-- TMC_PATCH36BFIX_REUSE_KEYS: remove duplicate knowmore_* rows
-- Safe to run even if no rows match (DELETE with no matches is a no-op).
-- This cleans up after Patch 36b which created duplicates.

DELETE FROM app_settings WHERE key LIKE 'knowmore_%';

-- Verify cleanup:
SELECT key, label FROM app_settings WHERE key LIKE 'knowmore_%';
-- (Should return 0 rows after deletion.)

-- Existing keys we reuse (already in your DB):
--   app_store_url     -> App Store button on /knowmore
--   play_store_url    -> Google Play button on /knowmore
--   social_facebook   -> Facebook button on /knowmore
--   social_instagram  -> Instagram button on /knowmore
--
-- These are editable in the admin Settings tab today — no migration needed.
