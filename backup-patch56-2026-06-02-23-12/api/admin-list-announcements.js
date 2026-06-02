// TMC_PATCH55B admin: list all announcements + dismiss counts.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { data: rows, error } = await supabase
    .from('announcements')
    .select('id, title, body, active, start_date, end_date, audience, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  if (!rows || rows.length === 0) return res.json({ ok: true, announcements: [] });

  /* Pull dismiss counts per announcement. */
  const ids = rows.map(r => r.id);
  const { data: seenRows } = await supabase
    .from('announcement_seen')
    .select('announcement_id')
    .in('announcement_id', ids);
  const seenCount = {};
  (seenRows || []).forEach(s => {
    seenCount[s.announcement_id] = (seenCount[s.announcement_id] || 0) + 1;
  });

  const nowMs = Date.now();
  const out = rows.map(r => {
    const startMs = r.start_date ? Date.parse(r.start_date) : 0;
    const endMs   = r.end_date   ? Date.parse(r.end_date)   : 0;
    let status;
    if (!r.active)            status = 'disabled';
    else if (nowMs < startMs) status = 'scheduled';
    else if (nowMs > endMs)   status = 'expired';
    else                      status = 'live';
    return {
      id:           r.id,
      title:        r.title,
      body:         r.body,
      active:       r.active,
      start_date:   r.start_date,
      end_date:     r.end_date,
      audience:     r.audience || 'all',
      created_at:   r.created_at,
      status:       status,
      dismiss_count: seenCount[r.id] || 0
    };
  });
  return res.json({ ok: true, announcements: out });
};
