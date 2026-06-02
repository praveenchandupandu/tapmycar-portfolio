// TMC_PATCH43_BROADCAST + TMC_PATCH45_CHANNELS + TMC_PATCH47_TAGS
// Admin broadcast endpoint. POST /api/send-broadcast.
// Channels: email, push, sms. Modes: preview (dry_run), send, history, detail.
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth'); /* TMC_PATCH40S3 */
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
const VALID_PLANS = ['etag', 'standard', 'premium'];
const VALID_CHANNELS = ['email', 'push', 'sms', 'inapp']; // TMC_PATCH59_INAPP

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailHtml(subject, bodyText, user) {
  const bodyHtml = esc(bodyText).replace(/\r?\n/g, '<br>');
  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +
                '&t=' + encodeURIComponent(user.unsubscribe_token || '');
  return '' +
    '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'max-width:560px;margin:0 auto;padding:8px;color:#111">' +
      '<div style="font-size:22px;font-weight:800;padding:12px 4px">' +
        'TapMyCar<span style="color:#FF6B00">.</span></div>' +
      '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;' +
        'padding:26px 24px">' +
        '<h1 style="font-size:19px;font-weight:800;margin:0 0 14px">' +
          esc(subject) + '</h1>' +
        '<div style="font-size:14px;line-height:1.65;color:#374151">' + bodyHtml + '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">' +
        'You are receiving this because you have a TapMyCar account.<br>' +
        '<a href="' + unsub + '" style="color:#9CA3AF">Unsubscribe from announcements</a>' +
        ' &middot; Praman Tech LLC, Connecticut, USA' +
      '</div>' +
    '</div>';
}

// Fetch users by a list of ids (chunked to stay within query limits).
async function usersByIds(ids) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = [];
  for (let i = 0; i < uniq.length; i += 300) {
    const chunk = uniq.slice(i, i + 300);
    const { data, error } = await supabase.from('users')
      .select('id, email, name, phone, plan, email_opt_out, sms_opt_in, unsubscribe_token')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    (data || []).forEach(function (u) { out.push(u); });
  }
  return out;
}

// Resolve the base recipient set from the selector.
async function resolveRecipients(recipients) {
  const mode = (recipients && recipients.mode) || 'all';

  // --- mode: tag -> owners of tags matching the filters ---
  if (mode === 'tag') {
    let tq = supabase.from('tags').select('owner_id').range(0, 99999);
    if (recipients.tag_type)     tq = tq.eq('tag_type', recipients.tag_type);
    if (recipients.status)       tq = tq.eq('status', recipients.status);
    if (recipients.batch_number) tq = tq.eq('batch_number', recipients.batch_number);
    if (recipients.token)        tq = tq.eq('token', String(recipients.token).trim());
    const { data: tags, error: terr } = await tq;
    if (terr) throw new Error(terr.message);
    const ownerIds = (tags || []).map(function (t) { return t.owner_id; }).filter(Boolean);
    if (!ownerIds.length) return [];
    return usersByIds(ownerIds);
  }

  // --- modes: all / plan / specific ---
  let q = supabase.from('users')
    .select('id, email, name, phone, plan, email_opt_out, sms_opt_in, unsubscribe_token')
    .range(0, 9999);
  if (mode === 'plan') {
    const plan = recipients && recipients.plan;
    if (VALID_PLANS.indexOf(plan) === -1) {
      throw new Error('Invalid plan. Must be one of: ' + VALID_PLANS.join(', '));
    }
    q = q.eq('plan', plan);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let users = data || [];

  if (mode === 'specific') {
    const ids = (recipients && recipients.ids) || [];
    if (!ids.length) throw new Error('No recipients specified');
    const want = ids.map(function (x) { return String(x).trim().toLowerCase(); });
    users = users.filter(function (u) {
      return want.indexOf(String(u.id).toLowerCase()) !== -1 ||
             want.indexOf(String(u.email || '').toLowerCase()) !== -1;
    });
  }
  return users;
}

async function getPushSubs(userIds) {
  const map = {};
  if (!userIds.length) return map;
  const { data, error } = await supabase
    .from('push_subscriptions').select('*').in('user_id', userIds);
  if (error) { console.error('push subs query failed:', error.message); return map; }
  (data || []).forEach(function (s) {
    if (!map[s.user_id]) map[s.user_id] = [];
    map[s.user_id].push(s);
  });
  return map;
}

function emailEligible(users) {
  return users.filter(function (u) { return u.email && !u.email_opt_out; });
}
function pushEligible(users, subsMap) {
  return users.filter(function (u) { return (subsMap[u.id] || []).length > 0; });
}
function smsEligible(users) {
  return users.filter(function (u) { return u.phone && u.sms_opt_in === true; });
}

async function sendEmail(users, subject, bodyText, broadcastId) {
  let sent = 0, failed = 0; const logRows = [];
  for (let i = 0; i < users.length; i += 100) {
    const chunk = users.slice(i, i + 100);
    const emails = chunk.map(function (u) {
      return { from: FROM, to: u.email, subject: String(subject),
               html: buildEmailHtml(subject, bodyText, u) };
    });
    let okBatch = true, errMsg = '';
    try {
      const r = await resend.batch.send(emails);
      if (r && r.error) { okBatch = false; errMsg = r.error.message || 'batch error'; }
    } catch (e) { okBatch = false; errMsg = (e && e.message) || 'send failed'; }
    chunk.forEach(function (u) {
      if (okBatch) sent++; else failed++;
      logRows.push({
        channel: 'email', event_type: 'broadcast',
        recipient_user_id: u.id, recipient_contact: u.email,
        subject: String(subject), body_preview: String(bodyText).slice(0, 200),
        sent_by: 'admin', broadcast_id: broadcastId,
        status: okBatch ? 'sent' : 'failed', error: okBatch ? null : errMsg
      });
    });
  }
  return { sent: sent, failed: failed, logRows: logRows };
}

async function sendPush(users, subsMap, subject, bodyText, broadcastId) {
  let sent = 0, failed = 0; const logRows = [];
  const payload = JSON.stringify({
    title: String(subject), body: String(bodyText).slice(0, 240), url: '/activity.html'
  });
  for (const u of users) {
    const subs = subsMap[u.id] || [];
    let delivered = false, lastErr = '';
    await Promise.all(subs.map(function (s) {
      return webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload
      ).then(function () { delivered = true; })
       .catch(function (err) {
         lastErr = (err && err.message) || 'push failed';
         if (err && err.statusCode === 410) {
           return supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
         }
       });
    }));
    if (delivered) sent++; else failed++;
    logRows.push({
      channel: 'push', event_type: 'broadcast',
      recipient_user_id: u.id, recipient_contact: 'push',
      subject: String(subject), body_preview: String(bodyText).slice(0, 200),
      sent_by: 'admin', broadcast_id: broadcastId,
      status: delivered ? 'sent' : 'failed', error: delivered ? null : lastErr
    });
  }
  return { sent: sent, failed: failed, logRows: logRows };
}

async function sendSms(users, subject, bodyText, broadcastId) {
  let sent = 0, failed = 0; const logRows = [];
  let client = null;
  try {
    const twilio = require('twilio');
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (e) { console.error('Twilio init failed:', e && e.message); }
  const text = (String(subject).trim() + ': ' + String(bodyText).trim()).slice(0, 600);
  for (let i = 0; i < users.length; i += 10) {
    const chunk = users.slice(i, i + 10);
    await Promise.all(chunk.map(function (u) {
      const done = function (okSms, errMsg) {
        if (okSms) sent++; else failed++;
        logRows.push({
          channel: 'sms', event_type: 'broadcast',
          recipient_user_id: u.id, recipient_contact: u.phone,
          subject: String(subject), body_preview: String(bodyText).slice(0, 200),
          sent_by: 'admin', broadcast_id: broadcastId,
          status: okSms ? 'sent' : 'failed', error: okSms ? null : errMsg
        });
      };
      if (!client) { done(false, 'Twilio not configured'); return Promise.resolve(); }
      return client.messages.create({
        body: text, from: process.env.TWILIO_PHONE_NUMBER, to: u.phone
      }).then(function () { done(true, null); })
        .catch(function (err) { done(false, (err && err.message) || 'sms failed'); });
    }));
  }
  return { sent: sent, failed: failed, logRows: logRows };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { admin_key, action, subject, recipients, dry_run } = body;

  let _tmcAdminKey = admin_key; /* TMC_PATCH40S3 */
  if (_tmcResolveAdminCookie(req)) _tmcAdminKey = process.env.ADMIN_SECRET_KEY;
  if (!_tmcAdminKey || _tmcAdminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  // --- HISTORY ---
  if (action === 'history') {
    const { data, error } = await supabase
      .from('notifications_log').select('*')
      .eq('event_type', 'broadcast')
      .order('created_at', { ascending: false }).limit(2000);
    if (error) return res.status(500).json({ error: error.message });
    const groups = {};
    (data || []).forEach(function (r) {
      const k = r.broadcast_id || ('row-' + r.id);
      if (!groups[k]) {
        groups[k] = { broadcast_id: k, channels: {}, subject: r.subject,
          sent_by: r.sent_by, created_at: r.created_at, sent: 0, failed: 0 };
      }
      groups[k].channels[r.channel] = true;
      if (r.status === 'failed') groups[k].failed++; else groups[k].sent++;
      if (r.created_at > groups[k].created_at) groups[k].created_at = r.created_at;
    });
    const list = Object.keys(groups).map(function (k) {
      const g = groups[k];
      return { broadcast_id: g.broadcast_id, subject: g.subject, sent_by: g.sent_by,
        created_at: g.created_at, sent: g.sent, failed: g.failed,
        channels: Object.keys(g.channels) };
    }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    return res.json({ success: true, broadcasts: list });
  }

  // --- DETAIL: per-recipient list for one broadcast ---
  if (action === 'detail') {
    const bid = body.broadcast_id;
    if (!bid) return res.status(400).json({ error: 'broadcast_id required' });
    const { data, error } = await supabase
      .from('notifications_log').select('*')
      .eq('broadcast_id', bid)
      .order('created_at', { ascending: true }).limit(5000);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    // Join recipient names from users.
    const ids = Array.from(new Set(rows.map(function (r) { return r.recipient_user_id; }).filter(Boolean)));
    const nameById = {};
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const { data: us } = await supabase.from('users').select('id, name').in('id', chunk);
      (us || []).forEach(function (u) { nameById[u.id] = u.name; });
    }
    const recipients_list = rows.map(function (r) {
      return {
        name: nameById[r.recipient_user_id] || null,
        contact: r.recipient_contact, channel: r.channel,
        status: r.status, error: r.error || null
      };
    });
    return res.json({ success: true, broadcast_id: bid, recipients: recipients_list });
  }

  // --- channels --- (TMC_PATCH59_INAPP)
  let channels = body.channels;
  if (!channels && body.channel) channels = [body.channel];
  if (!channels || !channels.length) channels = ['email'];
  // Legacy support: the old also_in_app flag = add the 'inapp' channel.
  if (body.also_in_app && channels.indexOf('inapp') === -1) channels.push('inapp');
  for (const c of channels) {
    if (VALID_CHANNELS.indexOf(c) === -1) {
      return res.status(400).json({ error: 'Invalid channel: ' + c });
    }
  }

  // --- resolve recipients ---
  let base;
  try { base = await resolveRecipients(recipients); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const needPush = channels.indexOf('push') !== -1;
  const subsMap = needPush
    ? await getPushSubs(base.map(function (u) { return u.id; }))
    : {};

  const eligible = {
    email: channels.indexOf('email') !== -1 ? emailEligible(base) : [],
    push:  needPush ? pushEligible(base, subsMap) : [],
    sms:   channels.indexOf('sms') !== -1 ? smsEligible(base) : []
  };
  const counts = { email: eligible.email.length, push: eligible.push.length, sms: eligible.sms.length };

  // --- PREVIEW ---
  if (dry_run) {
    return res.json({
      success: true, dry_run: true, channels: channels, counts: counts,
      base: base.length,                          // users matched by the selector
      count: counts.email,
      excluded_opted_out: base.length - counts.email
    });
  }

  // --- SEND --- (TMC_PATCH59_INAPP)
  // Subject is OPTIONAL. The message body is still required.
  if (!body.body || !String(body.body).trim()) {
    return res.status(400).json({ error: 'Please enter a message' });
  }
  // Email needs a non-empty subject line - fall back to a default if blank.
  const effectiveSubject = (subject && String(subject).trim())
    ? String(subject).trim()
    : 'TapMyCar Update';
  // In-app reaches every logged-in user, so it is not counted per-recipient.
  const sendsInApp = channels.indexOf('inapp') !== -1;
  const totalEligible = counts.email + counts.push + counts.sms;
  if (totalEligible === 0 && !sendsInApp) {
    return res.status(400).json({
      error: 'No eligible recipients across the selected channel(s). ' +
             base.length + ' user(s) matched, but none can receive on those channels.'
    });
  }

  const broadcastId = 'bc_' + Date.now();
  const results = {};
  let allLogRows = [];

  if (channels.indexOf('email') !== -1) {
    const r = await sendEmail(eligible.email, effectiveSubject, body.body, broadcastId);
    results.email = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }
  if (channels.indexOf('push') !== -1) {
    const r = await sendPush(eligible.push, subsMap, effectiveSubject, body.body, broadcastId);
    results.push = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }
  if (channels.indexOf('sms') !== -1) {
    const r = await sendSms(eligible.sms, effectiveSubject, body.body, broadcastId);
    results.sms = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }

  try {
    if (allLogRows.length) await supabase.from('notifications_log').insert(allLogRows);
  } catch (e) { console.error('notifications_log insert failed:', e && e.message); }

  let totalSent = 0, totalFailed = 0;
  Object.keys(results).forEach(function (c) {
    totalSent += results[c].sent; totalFailed += results[c].failed;
  });

  // TMC_PATCH59_INAPP: create the in-app announcement when the 'inapp'
  // channel is selected (covers both the new channel and legacy also_in_app).
  let announcementCreated = false;
  if (channels.indexOf('inapp') !== -1) {
    try {
      // TMC_PATCH61_NOTITLE: store the real subject, or "" when none was
      // given - so a no-subject popup shows no heading. Email keeps the
      // "TapMyCar Update" fallback separately; that does not come here.
      const annTitle = (subject && String(subject).trim()) ? String(subject).trim() : '';
      const { error: annErr } = await supabase.from('announcements').insert({
        title: annTitle, body: String(body.body),
        active: true, created_by: 'admin', broadcast_id: broadcastId
      });
      if (annErr) console.error('announcement insert failed:', annErr.message);
      else announcementCreated = true;
    } catch (e) { console.error('announcement insert error:', e && e.message); }
  }

  return res.json({
    success: true, broadcast_id: broadcastId, channels: channels,
    results: results, sent: totalSent, failed: totalFailed,
    base: base.length, count: totalEligible,
    announcement_created: announcementCreated
  });
};
