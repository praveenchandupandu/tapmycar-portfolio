// TMC_PATCH42_RETENTION_STATS
// Admin-only. Returns simple aggregated retention metrics:
//   exit_reasons:   { code: count, ... } over last 90 days
//   marketing_consented: total users with email_opt_out = false AND email IS NOT NULL
//   lapsed_emails_sent_30d: count of users with lapsed_email_sent_at in last 30 days

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (!resolveAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const ninetyDays = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDays = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    /* Exit reasons in last 90 days, grouped client-side (Supabase JS
       doesn't expose group-by; the volumes are small enough that fetching
       the rows and counting in JS is fine). */
    const { data: exits } = await supabase
      .from('users')
      .select('exit_reason_code')
      .gte('exit_reason_at', ninetyDays)
      .not('exit_reason_code', 'is', null);
    const exit_reasons = {};
    (exits || []).forEach(r => {
      const k = r.exit_reason_code || 'unknown';
      exit_reasons[k] = (exit_reasons[k] || 0) + 1;
    });

    const { count: opted_in } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('email_opt_out', false)
      .not('email', 'is', null);

    const { count: lapsed_30d } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('lapsed_email_sent_at', thirtyDays);

    return res.json({
      ok: true,
      exit_reasons,
      exit_total_90d: (exits || []).length,
      marketing_consented: opted_in || 0,
      lapsed_emails_sent_30d: lapsed_30d || 0
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
