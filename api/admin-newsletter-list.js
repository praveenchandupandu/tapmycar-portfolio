// TMC_PATCH52 admin: newsletter subscribers (paginated).
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
  const includeUnsubscribed = q.include_unsubscribed === '1';

  /* Counts */
  const { count: totalActive } = await supabase
    .from('newsletter_subscribers')
    .select('id', { count: 'exact', head: true })
    .is('unsubscribed_at', null);
  const { count: totalUnsubscribed } = await supabase
    .from('newsletter_subscribers')
    .select('id', { count: 'exact', head: true })
    .not('unsubscribed_at', 'is', null);

  /* Recent list */
  let q2 = supabase.from('newsletter_subscribers')
    .select('id, email, name, signup_source, signup_exit_reason, created_at, unsubscribed_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!includeUnsubscribed) q2 = q2.is('unsubscribed_at', null);

  const { data: rows, error } = await q2;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    ok: true,
    active_count:       totalActive || 0,
    unsubscribed_count: totalUnsubscribed || 0,
    subscribers: rows || []
  });
};
