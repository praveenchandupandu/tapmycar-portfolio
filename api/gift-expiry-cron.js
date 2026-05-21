// TMC_PATCH35C2_GIFT_LIFECYCLE
// Daily cron: expire lapsed gift trials + send reminder emails.
// Scheduled by vercel.json crons -> 09:00 UTC daily.
// Auth: Bearer CRON_SECRET (same as daily-report.js).

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';

/* whole-day difference between two dates (b - a), rounded down */
function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000);
}

function reminderEmail(name, daysLeft, planName) {
  const greeting = name ? ('Hi ' + name + ',') : 'Hi,';
  let subject, lead;
  if (daysLeft <= 0) {
    subject = 'Your TapMyCar trial ends today';
    lead = 'Your free ' + planName + ' trial ends today. Subscribe now to keep your tag active and your car protected.';
  } else if (daysLeft === 1) {
    subject = 'Your TapMyCar trial ends tomorrow';
    lead = 'Your free ' + planName + ' trial ends tomorrow. Subscribe now so your tag keeps working without interruption.';
  } else {
    subject = 'Your TapMyCar trial ends in ' + daysLeft + ' days';
    lead = 'Your free ' + planName + ' trial ends in ' + daysLeft + ' days. Subscribe any time to keep your tag active.';
  }
  const html =
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
    '<h2 style="color:#FF6B00">' + greeting + '</h2>' +
    '<p style="font-size:15px;line-height:1.6">' + lead + '</p>' +
    '<p style="margin:24px 0"><a href="' + SITE + '/dashboard.html" ' +
    'style="background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +
    'text-decoration:none;font-weight:700;font-size:14px">Subscribe now</a></p>' +
    '<p style="font-size:12px;color:#888">If your trial lapses, your tag pauses until you subscribe. ' +
    'You can reactivate any time \u2014 your vehicle details are saved.</p>' +
    '</div>';
  return { subject, html };
}

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== ('Bearer ' + process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const summary = { expired: 0, remindersSent: 0, errors: [] };

  try {
    /* All users currently on a gift trial (expiry set, not yet expired-out). */
    const { data: giftUsers, error: guErr } = await supabase
      .from('users')
      .select('id, name, email, plan, gift_plan_expires_at, gift_reminders_sent')
      .not('gift_plan_expires_at', 'is', null);

    if (guErr) {
      console.error('TMC_PATCH35C2_GIFT_LIFECYCLE: user query failed:', guErr.message);
      return res.status(500).json({ error: 'User query failed' });
    }

    for (const u of (giftUsers || [])) {
      try {
        const expiresAt = new Date(u.gift_plan_expires_at);
        const daysLeft = daysBetween(now, expiresAt);
        const planName = (u.plan || 'standard');
        const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);

        /* ---- EXPIRED: downgrade ---- */
        if (daysLeft < 0) {
          /* downgrade the user */
          await supabase
            .from('users')
            .update({
              plan: 'etag',
              gift_expired_at: now.toISOString(),
              gift_plan_expires_at: null,
              gift_reminders_sent: ''
            })
            .eq('id', u.id);

          /* set their gift tag(s) inactive + mark gift_expired */
          await supabase
            .from('tags')
            .update({ status: 'inactive', gift_expired: true })
            .eq('owner_id', u.id)
            .eq('is_gift', true)
            .eq('status', 'active');

          summary.expired++;
          continue;
        }

        /* ---- REMINDERS: 5d / 1d / 0d ---- */
        const sent = (u.gift_reminders_sent || '').split(',').filter(Boolean);
        let milestone = null;
        if (daysLeft <= 0 && sent.indexOf('0d') === -1) milestone = '0d';
        else if (daysLeft === 1 && sent.indexOf('1d') === -1) milestone = '1d';
        else if (daysLeft <= 5 && daysLeft > 1 && sent.indexOf('5d') === -1) milestone = '5d';

        if (milestone && u.email) {
          const mail = reminderEmail(u.name, daysLeft, planLabel);
          try {
            await resend.emails.send({
              from: FROM,
              to: u.email,
              subject: mail.subject,
              html: mail.html
            });
            sent.push(milestone);
            await supabase
              .from('users')
              .update({ gift_reminders_sent: sent.join(',') })
              .eq('id', u.id);
            summary.remindersSent++;
          } catch (mailErr) {
            console.error('TMC_PATCH35C2_GIFT_LIFECYCLE: email failed for', u.id, mailErr && mailErr.message);
            summary.errors.push('email:' + u.id);
          }
        }
      } catch (perUserErr) {
        console.error('TMC_PATCH35C2_GIFT_LIFECYCLE: per-user error', u.id, perUserErr && perUserErr.message);
        summary.errors.push('user:' + u.id);
      }
    }

    return res.json({ success: true, ran_at: now.toISOString(), ...summary });
  } catch (e) {
    console.error('TMC_PATCH35C2_GIFT_LIFECYCLE: fatal', e && e.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
