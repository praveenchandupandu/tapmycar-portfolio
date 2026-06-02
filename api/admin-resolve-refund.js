// TMC_PATCH53 admin endpoint: mark a failed refund as resolved.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { error } = await supabase.from('orders').update({
    refund_failed_resolved_at: new Date().toISOString(),
    refund_failed_resolved_by: admin.id || null
  }).eq('id', order_id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
