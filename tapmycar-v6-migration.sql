-- TapMyCar V6 schema migration
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

-- 1. Add welcome_message to users (nullable, max 120 chars)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS welcome_message TEXT;

-- 2. Add audio_url + alert_type to scan_logs for voice memos and alert categorization
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS audio_url TEXT,
  ADD COLUMN IF NOT EXISTS alert_type TEXT;

-- Done.
