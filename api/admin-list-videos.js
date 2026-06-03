// TMC_VIDEOS admin list (active + disabled).
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const kind = (req.query && req.query.kind) ? String(req.query.kind) : null;
  let q = supabase.from('videos')
    .select('*')
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true });
  if (kind && ['demo','review'].includes(kind)) q = q.eq('kind', kind);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, videos: data || [] });
};
