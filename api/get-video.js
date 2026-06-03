// TMC_VIDEOS_SHARE single-video fetch (for the share page OG tags).
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const id = (req.query && req.query.id) || (req.body && req.body.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const { data, error } = await supabase
    .from('videos')
    .select('id, kind, title, caption, video_url, thumbnail_url, creator_name, creator_sub, cta_label, cta_href, active')
    .eq('id', String(id))
    .eq('active', true)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
  return res.json({ ok: true, video: data });
};
