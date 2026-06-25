// TMC_PATCH48 renewal-reminder cron.
// Daily at 11:00 UTC. Finds subscribed users whose Stripe period_end is
// 7d or 1d away and sends a TapMyCar-branded reminder. Idempotent via
// two columns on the users table (set after a successful send).

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');
const stripe           = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);
const { sendPushToUser } = require('./_push-send');

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';
const CAP  = 100;

/* Reminder window. To change the schedule later, edit this array. We use
   day-windows with a 'fired_at' tracking column so a missed exact-day
   doesn't lose the reminder. */
const REMINDERS = [
  { key: '7d', column: 'renewal_reminder_7d_period_end', daysFrom: 5, daysTo: 7 },
  { key: '1d', column: 'renewal_reminder_1d_period_end', daysFrom: 0, daysTo: 1 }
];

function fmtDate(d) {
  try { return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
  catch (e) { return ''; }
}
function money(cents) { return '$' + (cents / 100).toFixed(2); }

function htmlFor7d(user, info) {
  const name  = user.name ? user.name.split(' ')[0] : 'there';
  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +
                '&t=' + encodeURIComponent(user.unsubscribe_token || '');
  return '' +
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
      '<div style="font-size:22px;font-weight:800;padding:12px 4px">' +
        'TapMyCar<span style="color:#FF6B00">.</span></div>' +
      '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:26px 24px">' +
        '<h1 style="font-size:18px;font-weight:800;margin:0 0 12px">Heads up, ' + name + '  your TapMyCar plan renews in a week</h1>' +
        '<p style="font-size:14px;line-height:1.65;color:#374151">Your annual subscription renews on <b>' + info.dateStr + '</b>. We will charge <b>' + info.amountStr + '</b>' +
          (info.card4 ? ' to your card ending in <b>' + info.card4 + '</b>' : ' to your card on file') + '.</p>' +
        '<p style="font-size:14px;line-height:1.65;color:#374151">Your tag stays active automatically  no action needed.</p>' +
        '<p style="font-size:13px;line-height:1.6;color:#6B7280;margin-top:18px">Want to update your card or cancel? Open Settings  Plan & Billing.</p>' +
        '<p style="margin:22px 0 4px"><a href="' + SITE + '/billing.html" ' +
          'style="background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +
          'text-decoration:none;font-weight:700;font-size:14px">Manage billing</a></p>' +
      '</div>' +
      '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">' +
        '<a href="' + unsub + '" style="color:#9CA3AF">Unsubscribe</a> &middot; Praman Tech LLC, Connecticut, USA' +
      '</div>' +
    '</div>';
}

function htmlFor1d(user, info) {
  const name  = user.name ? user.name.split(' ')[0] : 'there';
  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +
                '&t=' + encodeURIComponent(user.unsubscribe_token || '');
  return '' +
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
      '<div style="font-size:22px;font-weight:800;padding:12px 4px">' +
        'TapMyCar<span style="color:#FF6B00">.</span></div>' +
      '<div style="background:#fff;border:1px solid #FED7AA;border-left:4px solid #FF6B00;border-radius:14px;padding:26px 24px">' +
        '<h1 style="font-size:18px;font-weight:800;margin:0 0 12px;color:#C2410C">Your plan renews tomorrow</h1>' +
        '<p style="font-size:14px;line-height:1.65;color:#374151">Hi ' + name + ', just a reminder: your annual TapMyCar subscription renews on <b>' + info.dateStr + '</b>.</p>' +
        '<p style="font-size:14px;line-height:1.65;color:#374151">We will charge <b>' + info.amountStr + '</b>' +
          (info.card4 ? ' to your card ending in <b>' + info.card4 + '</b>' : ' to your card on file') + '.</p>' +
        '<p style="font-size:13px;line-height:1.6;color:#6B7280;margin-top:18px">No action needed. Want to make changes? Open Settings  Plan & Billing now.</p>' +
        '<p style="margin:22px 0 4px"><a href="' + SITE + '/billing.html" ' +
          'style="background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +
          'text-decoration:none;font-weight:700;font-size:14px">Manage billing</a></p>' +
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

  /* Pull all users with an active subscription_id. Capped. */
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, email, subscription_id, unsubscribe_token, email_opt_out, renewal_reminder_7d_period_end, renewal_reminder_1d_period_end')
    .not('subscription_id', 'is', null)
    .not('email', 'is', null)
    .eq('email_opt_out', false)
    .limit(CAP);

  if (error) {
    console.error('TMC_PATCH48 query error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  if (!users || users.length === 0) {
    return res.json({ ok: true, scanned: 0, sent: 0 });
  }

  let scanned = 0, sent = 0, failed = 0, skippedAlreadySent = 0, skippedOutOfWindow = 0;

  for (const u of users) {
    scanned++;
    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(u.subscription_id, { expand: ['default_payment_method'] });
    } catch (e) {
      console.warn('TMC_PATCH48 sub retrieve failed for ' + u.id + ':', e && e.message);
      continue;
    }
    if (!sub || !sub.current_period_end) continue;
    if (sub.status !== 'active' && sub.status !== 'trialing') continue;

    const periodEnd = new Date(sub.current_period_end * 1000);
    const daysUntil = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);

    const amount = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.unit_amount) || 0;
    const card4  = (sub.default_payment_method && sub.default_payment_method.card && sub.default_payment_method.card.last4) || null;
    const info = {
      dateStr:   fmtDate(periodEnd),
      amountStr: money(amount),
      card4
    };

    for (const r of REMINDERS) {
      if (daysUntil < r.daysFrom || daysUntil > r.daysTo) { skippedOutOfWindow++; continue; }
      /* idempotency: did we already send for THIS period_end? */
      const already = u[r.column];
      if (already && new Date(already).getTime() === periodEnd.getTime()) {
        skippedAlreadySent++;
        continue;
      }
      const html    = (r.key === '7d') ? htmlFor7d(u, info) : htmlFor1d(u, info);
      const subject = (r.key === '7d') ?
        'Your TapMyCar plan renews in a week' :
        'Your TapMyCar plan renews tomorrow';
      try {
        await resend.emails.send({ from: FROM, to: u.email, subject, html });
        // Mobile push for the 1-day reminder only (not 7d - too noisy)
        if (r.key === '1d') {
          try {
            await sendPushToUser(u.id, {
              title: 'Renews tomorrow',
              body: 'Your TapMyCar plan renews ' + info.dateStr + '.',
              data: { type: 'billing', url: '/billing.html' }
            });
          } catch (e) { console.error('renewal-1d push error:', e && e.message); }
        }
        const update = {}; update[r.column] = periodEnd.toISOString();
        await supabase.from('users').update(update).eq('id', u.id);
        sent++;
      } catch (e) {
        console.warn('TMC_PATCH48 send failed for ' + u.email + ' [' + r.key + ']:', e && e.message);
        failed++;
      }
    }
  }

  return res.json({ ok: true, scanned, sent, failed, skippedAlreadySent, skippedOutOfWindow });
};
