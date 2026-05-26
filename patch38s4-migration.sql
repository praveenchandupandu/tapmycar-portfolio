-- TapMyCar  Patch 38 Stage 4  token migration tracking
-- Adds two columns to `users` so the admin panel (Stage 4c) can show how
-- many sessions are still on the legacy UUID vs the new signed token.
-- Safe to run more than once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_token_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_token_at  timestamptz;
