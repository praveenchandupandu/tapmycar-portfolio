// TMC_COMIC save comic panels (admin only).
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const panels = (req.body && req.body.panels) || [];
  if (!Array.isArray(panels)) return res.status(400).json({ error: 'panels must be an array' });

  // Sanitize each panel
  const cleaned = panels.slice(0, 12).map(function (p) {
    return {
      image_url: typeof p.image_url === 'string' ? p.image_url.slice(0, 1000) : '',
      title:     typeof p.title === 'string'     ? p.title.slice(0, 200)     : '',
      caption:   typeof p.caption === 'string'   ? p.caption.slice(0, 500)   : ''
    };
  });

  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'comic_panels', value: JSON.stringify(cleaned) }, { onConflict: 'key' });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, count: cleaned.length });
};
