// TMC_VIDEOS_EDIT update existing video metadata (no re-upload).
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const b = req.body || {};
  if (!b.id) return res.status(400).json({ error: 'id required' });

  const patch = { updated_at: new Date().toISOString() };
  if (typeof b.title === 'string')          patch.title = b.title.slice(0, 200);
  if (typeof b.caption === 'string')        patch.caption = b.caption.slice(0, 500);
  if (typeof b.creator_name === 'string')   patch.creator_name = b.creator_name.slice(0, 100);
  if (typeof b.creator_sub === 'string')    patch.creator_sub = b.creator_sub.slice(0, 200);
  if (typeof b.cta_label === 'string')      patch.cta_label = b.cta_label.slice(0, 80);
  if (typeof b.cta_href === 'string')       patch.cta_href = b.cta_href.slice(0, 500);
  if (typeof b.poster_color === 'string')   patch.poster_color = b.poster_color.slice(0, 16);
  if (typeof b.poster_initial === 'string') patch.poster_initial = b.poster_initial.slice(0, 2).toUpperCase();
  if (typeof b.thumbnail_url === 'string' && b.thumbnail_url) patch.thumbnail_url = b.thumbnail_url.slice(0, 1000);
  if (b.kind === 'demo' || b.kind === 'review') patch.kind = b.kind;

  const { error } = await supabase.from('videos').update(patch).eq('id', b.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
