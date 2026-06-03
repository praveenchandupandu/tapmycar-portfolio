// TMC_VIDEOS register video row after upload.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const b = req.body || {};
  if (!b.kind || !['demo','review'].includes(b.kind)) return res.status(400).json({ error: 'kind required' });
  if (!b.title) return res.status(400).json({ error: 'title required' });
  if (!b.video_url) return res.status(400).json({ error: 'video_url required' });

  const { data: maxRow } = await supabase
    .from('videos')
    .select('sort_order')
    .eq('kind', b.kind)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow && maxRow.sort_order) || 0) + 10;

  const { data, error } = await supabase.from('videos').insert({
    kind:           b.kind,
    title:          String(b.title).slice(0, 200),
    caption:        b.caption ? String(b.caption).slice(0, 500) : null,
    video_url:      String(b.video_url).slice(0, 1000),
    thumbnail_url:  b.thumbnail_url ? String(b.thumbnail_url).slice(0, 1000) : null,
    poster_initial: b.poster_initial ? String(b.poster_initial).slice(0, 2).toUpperCase() : 'T',
    poster_color:   b.poster_color || '#FF6B00',
    creator_name:   b.creator_name ? String(b.creator_name).slice(0, 100) : 'TapMyCar',
    creator_sub:    b.creator_sub  ? String(b.creator_sub).slice(0, 200)  : 'Official  ·  Verified',
    cta_label:      b.cta_label    ? String(b.cta_label).slice(0, 80)    : null,
    cta_href:       b.cta_href     ? String(b.cta_href).slice(0, 500)    : null,
    sort_order:     nextOrder,
    active:         true
  }).select('id').single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, id: data && data.id });
};
