// TMC_PATCH30_COMP_ADMIN
// GET /api/admin-list-comped
//
// Admin-only. Every account currently on a comped plan, so you can see what
// has been given away and revoke it. Read-only.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let adminKey = req.headers['x-admin-key'];
  if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, plan, comped_plan_expires_at, comped_note, comped_at')
    .eq('comped_plan', true)
    .order('comped_at', { ascending: false });

  if (error) {
    console.error('comped list failed:', error.message);
    return res.status(500).json({ error: 'Could not load comped accounts' });
  }

  const now = Date.now();
  const rows = (data || []).map(function (u) {
    let daysLeft = null;
    if (u.comped_plan_expires_at) {
      daysLeft = Math.ceil((new Date(u.comped_plan_expires_at).getTime() - now) / 86400000);
    }
    return {
      id: u.id,
      name: u.name || '',
      email: u.email,
      plan: u.plan,
      permanent: !u.comped_plan_expires_at,
      expires_at: u.comped_plan_expires_at,
      days_left: daysLeft,
      note: u.comped_note || '',
      comped_at: u.comped_at
    };
  });

  return res.json({ success: true, count: rows.length, comped: rows });
};
