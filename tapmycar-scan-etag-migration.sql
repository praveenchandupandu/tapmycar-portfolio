-- TapMyCar — schema additions for eTag 30-day backup mechanism
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/_/sql

-- expires_at: when an eTag is reactivated alongside an active physical,
-- it gets a 30-day expiration. NULL means no expiration (default).
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Helpful index for lookups (optional but nice for performance)
CREATE INDEX IF NOT EXISTS tags_expires_at_idx ON public.tags(expires_at)
  WHERE expires_at IS NOT NULL;

-- Done.
