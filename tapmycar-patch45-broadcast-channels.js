// ============================================================================
// TapMyCar - Patch 45 (Notification System, STAGE 4a): Push + SMS channels
//
// PREREQUISITE
//   Patches 41-44 deployed. Web push works; the email broadcast tool works.
//
// WHAT THIS PATCH DOES
//   REWRITES api/send-broadcast.js so a broadcast can go out over any
//   combination of three channels: email, push, sms.
//
//   The request now accepts "channels": ["email","push","sms"] (an array).
//   The old single "channel":"email" is still accepted for backward
//   compatibility, so the current admin UI keeps working until Patch 46
//   upgrades it.
//
//   Per-channel recipient rules (each enforced automatically):
//     - email : must have an email AND not have email_opt_out = true.
//               Every email carries an unsubscribe link.
//     - push  : must have at least one saved browser push subscription.
//               (Having a subscription IS the opt-in.)
//     - sms   : must have a phone number AND sms_opt_in = true.
//               This is the TCPA consent gate - users are NEVER texted
//               unless they have explicitly opted in.
//
//   PREVIEW (dry_run) now returns a per-channel "counts" object, e.g.
//     { counts: { email: 12, push: 4, sms: 0 }, count: 12, ... }
//   ("count" is kept = email count for backward compatibility.)
//
//   SEND returns per-channel results plus overall totals, and logs one
//   notifications_log row per recipient per channel under one broadcast_id.
//
//   HISTORY now reports every channel a broadcast used.
//
//   web-push uses the same VAPID env vars fixed in Stage 1; SMS uses the
//   existing TWILIO_* env vars. Note: if Twilio A2P registration is not yet
//   approved, SMS sends will fail gracefully and be reported as "failed" -
//   the rest of the broadcast still completes.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch45-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' });
}
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 45 (Stage 4a) - Push + SMS broadcast channels');
log('============================================================');

const epPath = path.join(API, 'send-broadcast.js');
if (!fs.existsSync(epPath)) errExit('api/send-broadcast.js not found - run Patch 43 first.');

if (fs.readFileSync(epPath, 'utf8').indexOf('TMC_PATCH45_CHANNELS') !== -1) {
  skip('api/send-broadcast.js');
} else {
  backup(epPath, 'api/send-broadcast.js');

  const ENDPOINT = String.raw`// TMC_PATCH43_BROADCAST + TMC_PATCH45_CHANNELS
// Admin broadcast endpoint. POST /api/send-broadcast.
// Channels: email, push, sms. Modes: preview (dry_run), send, history.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const webpush = require('web-push');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// VAPID config for web push (same env vars fixed in Stage 1).
try {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.error('VAPID setup failed:', e && e.message);
}

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';
const VALID_PLANS = ['etag', 'standard', 'premium'];
const VALID_CHANNELS = ['email', 'push', 'sms'];

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
        '<div style="font-size:14px;line-height:1.65;color:#374151">' +
          bodyHtml + '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">' +
        'You are receiving this because you have a TapMyCar account.<br>' +
        '<a href="' + unsub + '" style="color:#9CA3AF">Unsubscribe from announcements</a>' +
        ' &middot; Praman Tech LLC, Connecticut, USA' +
      '</div>' +
    '</div>';
}

// Resolve the base recipient set from the selector. Channel filtering happens
// afterward, per channel.
async function resolveRecipients(recipients) {
  const mode = (recipients && recipients.mode) || 'all';
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

// Map of user_id -> array of push subscriptions, for the given user ids.
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

// --- channel eligibility ---
function emailEligible(users) {
  return users.filter(function (u) { return u.email && !u.email_opt_out; });
}
function pushEligible(users, subsMap) {
  return users.filter(function (u) { return (subsMap[u.id] || []).length > 0; });
}
function smsEligible(users) {
  return users.filter(function (u) { return u.phone && u.sms_opt_in === true; });
}

// --- channel senders. Each returns { sent, failed, logRows } ---
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
  } catch (e) {
    console.error('Twilio init failed:', e && e.message);
  }
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

  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  // --- HISTORY ---
  if (action === 'history') {
    const { data, error } = await supabase
      .from('notifications_log').select('*')
      .eq('event_type', 'broadcast')
      .order('created_at', { ascending: false }).limit(1000);
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

  // --- normalize channels (accept "channels" array OR legacy "channel" string) ---
  let channels = body.channels;
  if (!channels && body.channel) channels = [body.channel];
  if (!channels || !channels.length) channels = ['email'];
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
      count: counts.email,
      excluded_opted_out: base.length - counts.email
    });
  }

  // --- SEND ---
  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }
  if (!body.body || !String(body.body).trim()) {
    return res.status(400).json({ error: 'Message body is required' });
  }
  const totalEligible = counts.email + counts.push + counts.sms;
  if (totalEligible === 0) {
    return res.status(400).json({
      error: 'No eligible recipients across the selected channel(s).'
    });
  }

  const broadcastId = 'bc_' + Date.now();
  const results = {};
  let allLogRows = [];

  if (channels.indexOf('email') !== -1) {
    const r = await sendEmail(eligible.email, subject, body.body, broadcastId);
    results.email = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }
  if (channels.indexOf('push') !== -1) {
    const r = await sendPush(eligible.push, subsMap, subject, body.body, broadcastId);
    results.push = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }
  if (channels.indexOf('sms') !== -1) {
    const r = await sendSms(eligible.sms, subject, body.body, broadcastId);
    results.sms = { sent: r.sent, failed: r.failed };
    allLogRows = allLogRows.concat(r.logRows);
  }

  try {
    if (allLogRows.length) await supabase.from('notifications_log').insert(allLogRows);
  } catch (e) {
    console.error('notifications_log insert failed:', e && e.message);
  }

  let totalSent = 0, totalFailed = 0;
  Object.keys(results).forEach(function (c) {
    totalSent += results[c].sent; totalFailed += results[c].failed;
  });

  return res.json({
    success: true, broadcast_id: broadcastId, channels: channels,
    results: results, sent: totalSent, failed: totalFailed,
    count: totalEligible
  });
};
`;

  writeFile(epPath, ENDPOINT);
  checkJs(epPath, 'api/send-broadcast.js');
  ok('api/send-broadcast.js rewritten - email + push + sms channels');
}

log('');
log('============================================================');
log('Patch 45 (Stage 4a) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. The existing email broadcast UI keeps');
log('  working unchanged. Test the new channels from the /admin.html');
log('  console (uses the global adminKey):');
log('');
log('  PUSH preview (you have a push subscription from Stage 1):');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channels:["push"],dry_run:true,recipients:{mode:"all"}})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect counts.push >= 1');
log('');
log('  PUSH send to yourself:');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channels:["push"],subject:"Push test",body:"Broadcast push works.",');
log('      recipients:{mode:"specific",ids:["praveenchandu2828@gmail.com"]}})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect results.push.sent = 1, and a notification pops up.');
log('');
log('  SMS preview (counts.sms will be 0 until users opt in - expected):');
log('    ...channels:["sms"],dry_run:true,recipients:{mode:"all"}...');
log('    -> counts.sms = 0 is CORRECT: no user has sms_opt_in = true yet.');
log('       To test a real SMS send, first opt your own account in via SQL:');
log('         update users set sms_opt_in = true');
log('         where email = ' + "'" + 'praveenchandu2828@gmail.com' + "'" + ';');
log('       then send channels:["sms"] to yourself. Note: if Twilio A2P is');
log('       not approved yet, the send is reported as failed - that is a');
log('       Twilio account state, not a code bug.');
log('');
log('  Confirm push works, then I build Patch 46 - channel checkboxes in');
log('  the Broadcast tab UI.');
log('');
