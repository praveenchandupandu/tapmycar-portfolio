// TMC_VIDEOS public endpoint  list active videos by kind.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const kind = String((req.query && req.query.kind) || '').toLowerCase();
  if (!['demo','review'].includes(kind)) return res.status(400).json({ error: 'kind=demo|review required' });

  const { data, error } = await supabase
    .from('videos')
    .select('id, kind, title, caption, video_url, thumbnail_url, poster_initial, poster_color, creator_name, creator_sub, cta_label, cta_href, views, likes')
    .eq('kind', kind)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, videos: data || [] });
};
