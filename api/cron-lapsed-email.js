// TMC_PATCH42_LAPSED
// Daily cron at 10:00 UTC. Sends one re-engagement email to each user who:
//   - signed up 30+ days ago
//   - never paid (plan = 'etag' AND subscription_id is null)
//   - opted-in (email_opt_out = false)
//   - hasn't been emailed yet (lapsed_email_sent_at is null)
//   - is NOT in marketing_suppression by email
// Sets lapsed_email_sent_at after sending so they're never re-emailed.
// Capped at 50 sends per run. Bearer CRON_SECRET auth.

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';
const CAP  = 50;

function htmlFor(user) {
  const name = user.name ? user.name.split(' ')[0] : 'there';
  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +
                '&t=' + encodeURIComponent(user.unsubscribe_token || '');
  return '' +
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
      '<div style="font-size:22px;font-weight:800;padding:12px 4px">' +
        'TapMyCar<span style="color:#FF6B00">.</span></div>' +
      '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:26px 24px">' +
        '<h1 style="font-size:18px;font-weight:800;margin:0 0 12px">Hi ' + name + ', still curious about TapMyCar?</h1>' +
        '<p style="font-size:14px;line-height:1.65;color:#374151">You signed up a while back but haven\'t set up a tag yet. Most TapMyCar customers use it for one of these reasons:</p>' +
        '<ul style="font-size:14px;line-height:1.7;color:#374151;padding-left:18px">' +
          '<li>Help a stranger reach them privately if their car is blocking traffic</li>' +
          '<li>Get notified when someone is near their car</li>' +
          '<li>Skip writing a phone number on a dashboard note</li>' +
        '</ul>' +
        '<p style="margin:22px 0 4px"><a href="' + SITE + '/dashboard.html" ' +
          'style="background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +
          'text-decoration:none;font-weight:700;font-size:14px">See how it works</a></p>' +
      '</div>' +
      '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">' +
        '<a href="' + unsub + '" style="color:#9CA3AF">Unsubscribe</a> &middot; Praman Tech LLC, Connecticut, USA' +
      '</div>' +
    '</div>';
}

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== ('Bearer ' + process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  /* Find candidates. Server-side filtering keeps the payload small. */
  const { data: candidates, error: qerr } = await supabase
    .from('users')
    .select('id, email, name, unsubscribe_token, created_at')
    .eq('plan', 'etag')
    .is('subscription_id', null)
    .eq('email_opt_out', false)
    .is('lapsed_email_sent_at', null)
    .lt('created_at', cutoff)
    .not('email', 'is', null)
    .limit(CAP);

  if (qerr) {
    console.error('lapsed query error:', qerr.message);
    return res.status(500).json({ error: qerr.message });
  }
  if (!candidates || !candidates.length) {
    return res.json({ ok: true, sent: 0, skipped_suppressed: 0 });
  }

  /* Suppress anyone listed in marketing_suppression by their email. */
  const emails = candidates.map(u => u.email).filter(Boolean);
  const { data: suppressed } = await supabase
    .from('marketing_suppression')
    .select('email')
    .in('email', emails);
  const suppressedSet = new Set((suppressed || []).map(s => (s.email || '').toLowerCase()));

  let sent = 0, skipped = 0, failed = 0;
  for (const u of candidates) {
    if (suppressedSet.has((u.email || '').toLowerCase())) { skipped++; continue; }
    try {
      await resend.emails.send({
        from: FROM,
        to: u.email,
        subject: 'Still curious about TapMyCar?',
        html: htmlFor(u)
      });
      await supabase.from('users').update({
        lapsed_email_sent_at: new Date().toISOString()
      }).eq('id', u.id);
      sent++;
    } catch (e) {
      console.warn('lapsed send failed for ' + u.email + ':', e && e.message);
      failed++;
    }
  }

  return res.json({ ok: true, sent, skipped_suppressed: skipped, failed });
};
