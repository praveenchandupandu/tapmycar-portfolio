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
    /* TMC_PATCH42B: read from the dedicated exit_reasons table (which
       survives user deletion), grouped client-side. Volumes are small;
       fetching rows and counting in JS is fine. */
    const { data: exits } = await supabase
      .from('exit_reasons')
      .select('reason_code')
      .gte('created_at', ninetyDays);
    const exit_reasons = {};
    (exits || []).forEach(r => {
      const k = r.reason_code || 'unknown';
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
