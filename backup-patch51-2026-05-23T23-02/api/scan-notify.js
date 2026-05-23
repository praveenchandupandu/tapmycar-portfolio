// TMC_PATCH50_SCANNOTIFY - notify a tag owner that their tag was scanned.
// POST { tag_id }. Throttled per tag (cooldown). Channels: push + email.
// Scan alerts are transactional - they respect only the global email_opt_out.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const webpush = require('web-push');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

try {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
  );
} catch (e) { console.error('VAPID setup failed:', e && e.message); }

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';
const COOLDOWN_MS = 3 * 60 * 60 * 1000;  // 3 hours between alerts for one tag

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tag_id = req.body && req.body.tag_id;
  if (!tag_id) return res.status(400).json({ error: 'tag_id required' });

  // --- look up the tag + its owner ---
  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, token, vehicle_label, owner_id, ' +
            'users!tags_owner_id_fkey(id, name, email, email_opt_out, unsubscribe_token)')
    .eq('id', tag_id)
    .single();
  if (tagErr || !tag) return res.json({ success: true, notified: false, reason: 'tag not found' });

  const owner = tag.users;
  if (!owner || !owner.id) return res.json({ success: true, notified: false, reason: 'no owner' });

  // --- throttle: skip if this tag's owner was notified within the cooldown ---
  const { data: state } = await supabase
    .from('scan_notify_state').select('*').eq('tag_id', String(tag_id)).single();
  if (state && state.last_notified_at) {
    const last = new Date(state.last_notified_at).getTime();
    if (Number.isFinite(last) && (Date.now() - last) < COOLDOWN_MS) {
      return res.json({ success: true, notified: false, reason: 'throttled' });
    }
  }

  const label = tag.vehicle_label || 'your vehicle';
  const title = 'Your TapMyCar tag was scanned';
  const text = 'Someone just scanned the TapMyCar tag on ' + label + '.';

  let pushed = 0, emailed = 0;
  const logRows = [];

  // --- PUSH (if the owner has any subscription) ---
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions').select('*').eq('user_id', owner.id);
    if (subs && subs.length) {
      const payload = JSON.stringify({ title: title, body: text, url: '/activity.html' });
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload
          );
          pushed++;
        } catch (err) {
          if (err && err.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }
      }
      logRows.push({
        channel: 'push', event_type: 'scan',
        recipient_user_id: owner.id, recipient_contact: 'push',
        subject: title, body_preview: text, sent_by: 'system',
        status: pushed > 0 ? 'sent' : 'failed'
      });
    }
  } catch (e) { console.error('scan-notify push error:', e && e.message); }

  // --- EMAIL (unless globally opted out) ---
  if (owner.email && !owner.email_opt_out) {
    const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(owner.id) +
                  '&t=' + encodeURIComponent(owner.unsubscribe_token || '');
    const html =
      '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;' +
        'max-width:560px;margin:0 auto;padding:8px;color:#111">' +
        '<div style="font-size:22px;font-weight:800;padding:12px 4px">' +
          'TapMyCar<span style="color:#FF6B00">.</span></div>' +
        '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;' +
          'padding:26px 24px">' +
          '<h1 style="font-size:19px;font-weight:800;margin:0 0 14px">' + esc(title) + '</h1>' +
          '<div style="font-size:14px;line-height:1.65;color:#374151">' + esc(text) +
          '<br><br><a href="' + SITE + '/activity.html" style="color:#FF6B00;' +
          'font-weight:700">View scan activity</a></div>' +
        '</div>' +
        '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">' +
          '<a href="' + unsub + '" style="color:#9CA3AF">Unsubscribe from these emails</a>' +
          ' &middot; Praman Tech LLC, Connecticut, USA' +
        '</div>' +
      '</div>';
    try {
      await resend.emails.send({ from: FROM, to: owner.email, subject: title, html: html });
      emailed = 1;
      logRows.push({
        channel: 'email', event_type: 'scan',
        recipient_user_id: owner.id, recipient_contact: owner.email,
        subject: title, body_preview: text, sent_by: 'system', status: 'sent'
      });
    } catch (e) {
      console.error('scan-notify email error:', e && e.message);
      logRows.push({
        channel: 'email', event_type: 'scan',
        recipient_user_id: owner.id, recipient_contact: owner.email,
        subject: title, body_preview: text, sent_by: 'system',
        status: 'failed', error: (e && e.message) || 'send failed'
      });
    }
  }

  // --- record the audit rows + update the throttle state ---
  if (logRows.length) {
    try { await supabase.from('notifications_log').insert(logRows); }
    catch (e) { console.error('notifications_log insert failed:', e && e.message); }
  }
  try {
    await supabase.from('scan_notify_state').upsert({
      tag_id: String(tag_id),
      last_notified_at: new Date().toISOString(),
      notify_count: (state && state.notify_count ? state.notify_count : 0) + 1
    }, { onConflict: 'tag_id' });
  } catch (e) { console.error('scan_notify_state upsert failed:', e && e.message); }

  return res.json({ success: true, notified: true, pushed: pushed, emailed: emailed });
};
