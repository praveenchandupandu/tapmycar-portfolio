// TMC_VIDEOS admin toggle active or delete.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { id, action, active, sort_order } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  if (action === 'delete') {
    const { error } = await supabase.from('videos').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, deleted: true });
  }

  const patch = {};
  if (typeof active === 'boolean') patch.active = active;
  if (typeof sort_order === 'number') patch.sort_order = sort_order;
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from('videos').update(patch).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
