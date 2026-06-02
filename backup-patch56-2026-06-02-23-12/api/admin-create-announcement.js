// TMC_PATCH55B admin: create an announcement.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { title, body, start_date, end_date, audience } = req.body || {};

  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Body is required' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  const startMs = Date.parse(start_date);
  const endMs   = Date.parse(end_date);
  if (isNaN(startMs) || isNaN(endMs)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (endMs <= startMs) {
    return res.status(400).json({ error: 'end_date must be after start_date' });
  }
  const aud = (audience === 'existing') ? 'existing' : 'all';

  const { data, error } = await supabase.from('announcements').insert({
    title: (typeof title === 'string') ? title.trim().slice(0, 200) : null,
    body:  body.trim().slice(0, 2000),
    active: true,
    start_date: new Date(startMs).toISOString(),
    end_date:   new Date(endMs).toISOString(),
    audience: aud
  }).select('id').single();

  if (error) {
    console.error('admin-create-announcement error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  return res.json({ ok: true, id: data && data.id });
};
