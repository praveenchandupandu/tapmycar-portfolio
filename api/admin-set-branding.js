// TMC_BRANDING save landing-hero sticker image URL.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const url = (req.body && req.body.sticker_url) || '';
  if (typeof url !== 'string') return res.status(400).json({ error: 'sticker_url required' });
  if (url && !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'sticker_url must be a full https URL' });

  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'hero_sticker_url', value: url || null }, { onConflict: 'key' });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
