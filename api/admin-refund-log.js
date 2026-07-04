// TMC_PATCH08_LEDGER: admin endpoint - full refund ledger from refund_log.
// refund_log captures every refund (Cancel button, account deletion, and
// manual Stripe refunds) and survives account deletion.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit || '200', 10) || 200, 500);

  const { data, error } = await supabase
    .from('refund_log')
    .select('id, created_at, source, status, amount_cents, currency, user_id, user_email, user_name, plan, stripe_refund_id, stripe_charge_id, stripe_customer_id, subscription_id')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, refunds: data || [] });
};
