// TMC_PATCH53 admin endpoint: list orders with failed refunds.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const includeResolved = req.query && req.query.include_resolved === '1';

  let q = supabase.from('orders')
    .select('id, user_id, amount, stripe_id, subscription_id, refund_failed_at, refund_error_message, refund_failed_resolved_at, refund_failed_resolved_by, created_at')
    .not('refund_failed_at', 'is', null)
    .order('refund_failed_at', { ascending: false })
    .limit(100);

  if (!includeResolved) q = q.is('refund_failed_resolved_at', null);

  const { data: orders, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  if (!orders || orders.length === 0) return res.json({ ok: true, orders: [] });

  /* Pull user details for the listed orders. */
  const userIds = Array.from(new Set(orders.map(o => o.user_id))).filter(Boolean);
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email')
    .in('id', userIds);
  const userById = {};
  (users || []).forEach(u => { userById[u.id] = u; });

  const out = orders.map(o => ({
    order_id: o.id,
    user: userById[o.user_id] || { id: o.user_id, name: null, email: null },
    amount_cents: o.amount || 0,
    stripe_id: o.stripe_id,
    subscription_id: o.subscription_id,
    refund_failed_at: o.refund_failed_at,
    refund_error_message: o.refund_error_message,
    resolved: !!o.refund_failed_resolved_at,
    resolved_at: o.refund_failed_resolved_at,
    created_at: o.created_at
  }));

  return res.json({ ok: true, orders: out });
};
