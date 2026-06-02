// TMC_PATCH51B admin stats for the pre-delete retention offer.
// Returns counts + recent accepted list. Last 90 days by default.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const days  = Math.min(parseInt((req.query && req.query.days) || '90', 10) || 90, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  /* Count offers shown in the window. */
  const { count: shown, error: e1 } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('retention_offer_shown_at', since);
  if (e1) return res.status(500).json({ error: e1.message });

  /* Count + list accepted. */
  const { data: accepted, error: e2 } = await supabase
    .from('users')
    .select('id, name, email, retention_offer_accepted_at, retention_offer_exit_reason')
    .gte('retention_offer_accepted_at', since)
    .order('retention_offer_accepted_at', { ascending: false })
    .limit(10);
  if (e2) return res.status(500).json({ error: e2.message });

  /* Total accepted (for accurate rate, not just the 10 we listed). */
  const { count: acceptedTotal, error: e3 } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('retention_offer_accepted_at', since);
  if (e3) return res.status(500).json({ error: e3.message });

  /* Credit issued: count RETENTION-coded referrals in the window. */
  const { data: creditRows } = await supabase
    .from('referrals')
    .select('credit_amount, applied_at')
    .eq('referral_code', 'RETENTION')
    .gte('applied_at', since);
  const creditIssuedCents = (creditRows || []).reduce(function (sum, r) {
    return sum + Math.round((parseFloat(r.credit_amount) || 0) * 100);
  }, 0);

  return res.json({
    ok: true,
    window_days: days,
    shown: shown || 0,
    accepted: acceptedTotal || 0,
    accept_rate: (shown && shown > 0) ? Math.round(((acceptedTotal || 0) / shown) * 100) : 0,
    credit_issued_cents: creditIssuedCents,
    recent_accepted: (accepted || []).map(function (u) {
      return {
        user_id:        u.id,
        name:           u.name,
        email:          u.email,
        accepted_at:    u.retention_offer_accepted_at,
        exit_reason:    u.retention_offer_exit_reason
      };
    })
  });
};
