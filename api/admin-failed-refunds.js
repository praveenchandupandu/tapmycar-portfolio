// TMC_PATCH53_FIX admin endpoint: list both failed AND successful refunds.
// URL kept as /api/admin-failed-refunds for backward compatibility.
// Query params:
//   include_resolved=1   show failed refunds that have been resolved too
//   days=30              days back for successful refunds (default 30)
//   limit=100            cap on successful refunds (default 100)

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const includeResolved = q.include_resolved === '1';
  const days = Math.min(parseInt(q.days || '30', 10) || 30, 365);
  const limit = Math.min(parseInt(q.limit || '100', 10) || 100, 200);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  /* Failed refunds */
  let qFailed = supabase.from('orders')
    .select('id, user_id, amount, stripe_id, subscription_id, refund_failed_at, refund_error_message, refund_failed_resolved_at, refund_failed_resolved_by, created_at')
    .not('refund_failed_at', 'is', null)
    .order('refund_failed_at', { ascending: false })
    .limit(100);
  if (!includeResolved) qFailed = qFailed.is('refund_failed_resolved_at', null);

  /* Successful refunds (within the requested window) */
  const qSuccess = supabase.from('orders')
    .select('id, user_id, amount, stripe_id, subscription_id, refund_succeeded_at, refund_amount_cents, refund_stripe_id, created_at')
    .not('refund_succeeded_at', 'is', null)
    .gte('refund_succeeded_at', since)
    .order('refund_succeeded_at', { ascending: false })
    .limit(limit);

  const [failedRes, successRes] = await Promise.all([qFailed, qSuccess]);
  if (failedRes.error)  return res.status(500).json({ error: failedRes.error.message });
  if (successRes.error) return res.status(500).json({ error: successRes.error.message });

  const failedRows  = failedRes.data  || [];
  const successRows = successRes.data || [];
  const userIds = Array.from(new Set([...failedRows, ...successRows].map(o => o.user_id))).filter(Boolean);

  let userById = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds);
    (users || []).forEach(u => { userById[u.id] = u; });
  }

  const failed = failedRows.map(o => ({
    status: o.refund_failed_resolved_at ? 'failed_resolved' : 'failed_open',
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

  const success = successRows.map(o => ({
    status: 'succeeded',
    order_id: o.id,
    user: userById[o.user_id] || { id: o.user_id, name: null, email: null },
    original_amount_cents: o.amount || 0,
    refund_amount_cents:   o.refund_amount_cents || 0,
    refund_stripe_id:      o.refund_stripe_id,
    subscription_id:       o.subscription_id,
    refund_succeeded_at:   o.refund_succeeded_at,
    created_at:            o.created_at
  }));

  return res.json({ ok: true, failed, success, window_days: days });
};
