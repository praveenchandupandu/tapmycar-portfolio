-- TMC_PATCH36B_KNOWMORE_ADMIN: seed app_settings rows for the knowmore page URLs
-- Run this in Supabase SQL Editor BEFORE deploying Patch 36b.
-- Idempotent: ON CONFLICT DO NOTHING so re-running is safe.

INSERT INTO app_settings (key, value, slots, setting_type, label, description, sort_order)
VALUES
  ('knowmore_website_url',
   'https://tapmycar.io',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Website URL (knowmore)',
   'Big primary button on the sticker-back page. Default: tapmycar.io',
   200),

  ('knowmore_app_store_url',
   '',
   ARRAY['knowmore.actions']::text[],
   'url',
   'App Store URL (knowmore)',
   'Leave blank to show the App Store button as "soon" (greyed out).',
   201),

  ('knowmore_play_store_url',
   '',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Google Play URL (knowmore)',
   'Leave blank to show the Google Play button as "soon" (greyed out).',
   202),

  ('knowmore_facebook_url',
   'https://facebook.com/tapmycar',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Facebook URL (knowmore)',
   'Leave blank to hide the Facebook button.',
   203),

  ('knowmore_instagram_url',
   'https://instagram.com/tapmycar',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Instagram URL (knowmore)',
   'Leave blank to hide the Instagram button.',
   204)
ON CONFLICT (key) DO NOTHING;

-- Verify:
-- SELECT key, value, slots, label, sort_order FROM app_settings
-- WHERE key LIKE 'knowmore_%' ORDER BY sort_order;
