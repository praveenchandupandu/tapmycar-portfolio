// TMC_BRANDING return current landing-hero sticker image.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'hero_sticker_url')
    .maybeSingle();

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, sticker_url: (data && data.value) || null });
};
