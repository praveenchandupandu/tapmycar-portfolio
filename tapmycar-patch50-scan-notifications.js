// ============================================================================
// TapMyCar - Patch 50 (Notification System, STAGE 5): Scan notifications
//
// PREREQUISITE
//   Run tapmycar-patch50-scan-notify-schema.sql in Supabase FIRST
//   (creates the scan_notify_state throttle table).
//   Patches 41-49 deployed (push works, send-push + notifications_log exist).
//
// WHAT THIS PATCH DOES
//   1. api/scan-notify.js  - NEW. Given a tag_id, notifies that tag's OWNER
//      that their tag was scanned. It:
//        - looks up the tag + owner,
//        - THROTTLES via scan_notify_state: if the owner was already notified
//          for this tag within the cooldown (3h), it does nothing,
//        - sends on PUSH (if the owner has a subscription) and EMAIL
//          (unless the owner has email_opt_out = true),
//        - SMS is intentionally NOT used (a scan is not urgent enough to
//          justify per-message cost),
//        - logs each send to notifications_log with event_type = 'scan'.
//      Scan alerts are transactional, so they respect only the global
//      email_opt_out flag - no marketing-style opt-in is required.
//
//   2. api/get-tag.js  - HOOKED. Right after a scan is logged to scan_logs,
//      get-tag.js fires a non-blocking call to /api/scan-notify. Fire-and-
//      forget: the tag page response is NOT delayed, and a notification
//      failure can never break tag display.
//
//   No vercel.json change (/api/scan-notify covered by the existing rewrite).
//
// Properties: idempotent (safe to re-run), validates JS, backs up changed files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch50-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, c) { fs.writeFileSync(p, c, { encoding: 'utf8' }); }
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
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
log('TapMyCar Patch 50 (Stage 5) - Scan notifications');
log('================================================');

// ----------------------------------------------------------------------------
// STEP 1 - create api/scan-notify.js
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/scan-notify.js (NEW)');

const SCAN_NOTIFY = String.raw`// TMC_PATCH50_SCANNOTIFY - notify a tag owner that their tag was scanned.
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
`;

const scanNotifyPath = path.join(API, 'scan-notify.js');
if (fs.existsSync(scanNotifyPath) &&
    fs.readFileSync(scanNotifyPath, 'utf8').indexOf('TMC_PATCH50_SCANNOTIFY') !== -1) {
  skip('api/scan-notify.js');
} else {
  backup(scanNotifyPath, 'api/scan-notify.js');
  writeFile(scanNotifyPath, SCAN_NOTIFY);
  checkJs(scanNotifyPath, 'api/scan-notify.js');
  ok('Created api/scan-notify.js');
}

// ----------------------------------------------------------------------------
// STEP 2 - hook get-tag.js: fire scan-notify after the scan is logged
// ----------------------------------------------------------------------------
log('');
log('Step 2 - api/get-tag.js (hook scan-notify)');

const getTagPath = path.join(API, 'get-tag.js');
let getTagSrc = fs.readFileSync(getTagPath, 'utf8');

if (getTagSrc.indexOf('TMC_PATCH50_SCANNOTIFY') !== -1) {
  skip('api/get-tag.js hook');
} else {
  backup(getTagPath, 'api/get-tag.js');

  // Anchor: the end of the scan-log block (note: this region uses LF endings).
  const HOOK_ANCHOR =
    '      scan_id = scan?.id;\n' +
    '    }\n';

  const HOOK_NEW =
    '      scan_id = scan?.id;\n' +
    '\n' +
    '      // TMC_PATCH50_SCANNOTIFY: tell the tag owner their tag was scanned.\n' +
    '      // Fire-and-forget - never delays or breaks the tag page response.\n' +
    '      try {\n' +
    '        const proto = req.headers["x-forwarded-proto"] || "https";\n' +
    '        const host = req.headers["host"];\n' +
    '        if (host) {\n' +
    '          fetch(proto + "://" + host + "/api/scan-notify", {\n' +
    '            method: "POST",\n' +
    '            headers: { "Content-Type": "application/json" },\n' +
    '            body: JSON.stringify({ tag_id: tag.id })\n' +
    '          }).catch(function (e) { console.error("scan-notify call failed:", e && e.message); });\n' +
    '        }\n' +
    '      } catch (e) {\n' +
    '        console.error("scan-notify dispatch error (non-fatal):", e && e.message);\n' +
    '      }\n' +
    '    }\n';

  getTagSrc = replaceOnce(getTagSrc, HOOK_ANCHOR, HOOK_NEW, 'get-tag.js scan-notify hook');
  writeFile(getTagPath, getTagSrc);
  checkJs(getTagPath, 'api/get-tag.js');
  ok('Hooked scan-notify into get-tag.js (fire-and-forget after scan log)');
}

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('================================================');
log('Patch 50 (Stage 5) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  BEFORE PUSHING: confirm tapmycar-patch50-scan-notify-schema.sql has');
log('  been run in Supabase (creates the scan_notify_state table).');
log('');
log('  Commit + push, wait ~60s, then test:');
log('   1. Make sure your own account owns an ACTIVE tag and has web push');
log('      enabled (open /dashboard.html once to register push).');
log('   2. Open that tag\u0027s public page: tapmycar.io/tag/<token>');
log('      (or scan the physical tag). This logs a scan.');
log('   3. Within a few seconds you should get a push notification');
log('      "Your TapMyCar tag was scanned" and an email (if not opted out).');
log('   4. Scan the SAME tag again immediately -> NO second notification');
log('      (throttled - 3h cooldown). Confirm in Supabase:');
log('        select * from scan_notify_state;        (one row, notify_count 1)');
log('        select event_type,channel,status from notifications_log');
log('          where event_type = \u0027scan\u0027 order by created_at desc;');
log('');
log('  That completes Stage 5 - the full notification system is done.');
log('');
