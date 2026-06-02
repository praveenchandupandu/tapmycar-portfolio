// TMC_PATCH55B admin: soft-disable an announcement (sets active=false).
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { id, active } = req.body || {};
  if (typeof id === 'undefined' || id === null) {
    return res.status(400).json({ error: 'id required' });
  }
  const newActive = (active === true);

  const { error } = await supabase.from('announcements')
    .update({ active: newActive })
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, id: id, active: newActive });
};
