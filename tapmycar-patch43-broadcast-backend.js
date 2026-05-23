// ============================================================================
// TapMyCar - Patch 43 (Notification System, STAGE 3a): Email broadcast backend
//
// PREREQUISITE
//   Patch 42 schema SQL must already be applied (email_opt_out column +
//   notifications_log table + unsubscribe_token). It is - confirmed in testing.
//
// WHAT THIS PATCH DOES
//   Creates ONE new file: api/send-broadcast.js - an admin-only endpoint that
//   powers the broadcast tool. Three modes, all on POST /api/send-broadcast:
//
//     1. PREVIEW   { admin_key, channel:"email", recipients, dry_run:true }
//        -> resolves the recipient list, returns { count } WITHOUT sending.
//           This is what the admin UI's live "will send to N users" uses.
//
//     2. SEND      { admin_key, channel:"email", subject, body, recipients }
//        -> sends the email to every matching recipient, logs each send to
//           notifications_log under one shared broadcast_id, returns counts.
//
//     3. HISTORY   { admin_key, action:"history" }
//        -> returns recent broadcasts grouped by broadcast_id for the UI.
//
//   Recipient selection (the "recipients" object):
//     { mode:"all" }                              -> every user
//     { mode:"plan", plan:"etag|standard|premium"} -> users on that plan
//     { mode:"specific", ids:[...] }               -> ids OR emails, mixed ok
//
//   Compliance: the email channel ALWAYS excludes users with
//   email_opt_out = true, and every email includes a working unsubscribe
//   link (/unsubscribe.html?u=<id>&t=<token>) - legally required for
//   mass/announcement email.
//
//   Email is sent via Resend batch send (resend.batch.send, up to 100 per
//   call) so a broadcast finishes well inside the 10s function limit.
//
//   This patch is EMAIL ONLY. Push and SMS channels are added in Stage 4.
//
//   No vercel.json change: /api/send-broadcast is covered by the existing
//   /api/:path* rewrite.
//
// Properties: idempotent (safe to re-run), validates JS, backs up if present.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch43-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' }); // UTF-8, no BOM
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
log('TapMyCar Patch 43 (Stage 3a) - Email broadcast backend');
log('======================================================');

// ----------------------------------------------------------------------------
// The endpoint source
// ----------------------------------------------------------------------------
const ENDPOINT = String.raw`// TMC_PATCH43_BROADCAST - admin email broadcast endpoint.
// POST /api/send-broadcast. Modes: preview (dry_run), send, history.
// Stage 3a = EMAIL channel only. Push + SMS arrive in Stage 4.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';
const VALID_PLANS = ['etag', 'standard', 'premium'];

// Escape user-entered text so the admin's message cannot break the email HTML.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Wrap the admin's plain-text message in a branded HTML email. Each recipient
// gets their own unsubscribe link (legally required for announcement email).
function buildEmailHtml(subject, body, user) {
  const bodyHtml = esc(body).replace(/\r?\n/g, '<br>');
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

// Resolve the recipient user rows from the recipients selector.
async function resolveRecipients(recipients) {
  const mode = (recipients && recipients.mode) || 'all';
  let q = supabase.from('users')
    .select('id, email, name, plan, email_opt_out, unsubscribe_token')
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { admin_key, action, channel, subject, recipients, dry_run } = body;

  // --- admin auth (same pattern as moderate-review.js) ---
  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  // --- HISTORY mode ---
  if (action === 'history') {
    const { data, error } = await supabase
      .from('notifications_log')
      .select('*')
      .eq('event_type', 'broadcast')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });

    // Group rows by broadcast_id into one summary per broadcast.
    const groups = {};
    (data || []).forEach(function (r) {
      const k = r.broadcast_id || ('row-' + r.id);
      if (!groups[k]) {
        groups[k] = {
          broadcast_id: k, channel: r.channel, subject: r.subject,
          sent_by: r.sent_by, created_at: r.created_at,
          total: 0, sent: 0, failed: 0
        };
      }
      groups[k].total++;
      if (r.status === 'failed') groups[k].failed++;
      else groups[k].sent++;
      if (r.created_at > groups[k].created_at) groups[k].created_at = r.created_at;
    });
    const list = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    return res.json({ success: true, broadcasts: list });
  }

  // --- SEND / PREVIEW mode (email only in Stage 3a) ---
  const ch = channel || 'email';
  if (ch !== 'email') {
    return res.status(400).json({ error: 'Only the email channel is available right now.' });
  }

  let recipientUsers;
  try {
    recipientUsers = await resolveRecipients(recipients);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Email channel: drop opted-out users and users with no email address.
  const eligible = recipientUsers.filter(function (u) {
    return u.email && !u.email_opt_out;
  });
  const optedOut = recipientUsers.length - eligible.length;

  // PREVIEW: report the count, send nothing.
  if (dry_run) {
    return res.json({
      success: true, dry_run: true, channel: 'email',
      count: eligible.length, excluded_opted_out: optedOut
    });
  }

  // SEND: validate the message.
  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: 'Subject is required' });
  }
  if (!body.body || !String(body.body).trim()) {
    return res.status(400).json({ error: 'Message body is required' });
  }
  if (!eligible.length) {
    return res.status(400).json({ error: 'No eligible recipients (0 after opt-out filtering).' });
  }

  const broadcastId = 'bc_' + Date.now();
  let sentCount = 0, failedCount = 0;
  const logRows = [];

  // Send in batches of 100 via Resend batch send.
  for (let i = 0; i < eligible.length; i += 100) {
    const chunk = eligible.slice(i, i + 100);
    const emails = chunk.map(function (u) {
      return {
        from: FROM, to: u.email, subject: String(subject),
        html: buildEmailHtml(subject, body.body, u)
      };
    });

    let batchOk = true, batchErr = '';
    try {
      const result = await resend.batch.send(emails);
      if (result && result.error) { batchOk = false; batchErr = result.error.message || 'batch error'; }
    } catch (e) {
      batchOk = false; batchErr = (e && e.message) || 'send failed';
    }

    chunk.forEach(function (u) {
      if (batchOk) sentCount++; else failedCount++;
      logRows.push({
        channel: 'email', event_type: 'broadcast',
        recipient_user_id: u.id, recipient_contact: u.email,
        subject: String(subject),
        body_preview: String(body.body).slice(0, 200),
        sent_by: 'admin', broadcast_id: broadcastId,
        status: batchOk ? 'sent' : 'failed',
        error: batchOk ? null : batchErr
      });
    });
  }

  // Write the audit log (one row per recipient).
  try {
    await supabase.from('notifications_log').insert(logRows);
  } catch (e) {
    console.error('notifications_log insert failed:', e && e.message);
  }

  return res.json({
    success: true, broadcast_id: broadcastId, channel: 'email',
    sent: sentCount, failed: failedCount,
    count: eligible.length, excluded_opted_out: optedOut
  });
};
`;

// ----------------------------------------------------------------------------
// Write api/send-broadcast.js
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/send-broadcast.js (NEW)');

const epPath = path.join(API, 'send-broadcast.js');
if (fs.existsSync(epPath) &&
    fs.readFileSync(epPath, 'utf8').indexOf('TMC_PATCH43_BROADCAST') !== -1) {
  skip('api/send-broadcast.js');
} else {
  backup(epPath, 'api/send-broadcast.js');
  writeFile(epPath, ENDPOINT);
  checkJs(epPath, 'api/send-broadcast.js');
  ok('Created api/send-broadcast.js');
}

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('======================================================');
log('Patch 43 (Stage 3a) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s for Vercel, then TEST from the browser');
log('  console (any page on www.tapmycar.io). You need your admin key -');
log('  it is the ADMIN_SECRET_KEY env var; in the admin page it is the');
log('  global "adminKey" variable, so on /admin.html you can just use it.');
log('');
log('  TEST 1 - preview count (sends nothing):');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channel:"email",dry_run:true,recipients:{mode:"all"}})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect { success:true, dry_run:true, count:<N>, ... }');
log('');
log('  TEST 2 - real send to ONLY yourself (mode:"specific"):');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      channel:"email",subject:"TapMyCar test broadcast",');
log('      body:"Hello - this is a broadcast test.",');
log('      recipients:{mode:"specific",ids:["praveenchandu2828@gmail.com"]}})})');
log('      .then(r=>r.json()).then(console.log)');
log('    -> expect { success:true, sent:1, failed:0 }');
log('    -> check your inbox; the email must have a working Unsubscribe link.');
log('');
log('  TEST 3 - history:');
log('    fetch("/api/send-broadcast",{method:"POST",headers:{"Content-Type":');
log('      "application/json"},body:JSON.stringify({admin_key:adminKey,');
log('      action:"history"})}).then(r=>r.json()).then(console.log)');
log('    -> expect your test broadcast listed with sent:1.');
log('');
log('  Confirm those work, then I build Patch 44 - the admin Broadcast tab.');
log('');
