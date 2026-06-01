/* ============================================================================
 * TapMyCar  Patch 48  renewal reminder emails (7d + 1d)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch48-renewal-reminders.js
 *
 * Two TapMyCar-branded reminder emails for users with active subscriptions:
 *
 *   - 7 days before renewal: a friendly heads-up
 *   - 1 day before renewal: a more urgent reminder
 *
 * Daily cron at 11:00 UTC scans all users with subscription_id set, queries
 * Stripe for the actual period_end, and decides per-user whether to send.
 * Idempotent via two columns added in patch48-migration.sql:
 *   - renewal_reminder_7d_period_end
 *   - renewal_reminder_1d_period_end
 * Each holds the period_end the reminder was sent FOR. If the column
 * already matches the current period_end, we skip.
 *
 * Cap: 100 subscriptions processed per run (we don't have 100 users yet,
 * but if you grow this protects you from Stripe rate limits).
 *
 * IMPORTANT  this patch ASSUMES patch48-migration.sql has been run.
 * Without those columns the cron will throw on every send.
 *
 * Files created/modified:
 *   1. api/cron-renewal-reminders.js  NEW.
 *   2. vercel.json                    new cron entry at 11:00 UTC daily.
 *   3. Stripe Dashboard               you should DISABLE Stripe's own
 *                                     upcoming-invoice emails to avoid the
 *                                     customer getting two messages.
 *
 * SAFE TO RE-RUN: vercel.json check is idempotent. cron file written only
 * if missing the marker.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH48';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch48-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CRON_FILE = path.join('api', 'cron-renewal-reminders.js');
const VERCEL = 'vercel.json';

const CRON_BODY = [
  "// TMC_PATCH48 renewal-reminder cron.",
  "// Daily at 11:00 UTC. Finds subscribed users whose Stripe period_end is",
  "// 7d or 1d away and sends a TapMyCar-branded reminder. Idempotent via",
  "// two columns on the users table (set after a successful send).",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { Resend }       = require('resend');",
  "const stripe           = require('stripe')(process.env.STRIPE_SECRET_KEY);",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "const resend   = new Resend(process.env.RESEND_API_KEY);",
  "",
  "const FROM = 'TapMyCar <noreply@tapmycar.io>';",
  "const SITE = 'https://tapmycar.io';",
  "const CAP  = 100;",
  "",
  "/* Reminder window. To change the schedule later, edit this array. We use",
  "   day-windows with a 'fired_at' tracking column so a missed exact-day",
  "   doesn't lose the reminder. */",
  "const REMINDERS = [",
  "  { key: '7d', column: 'renewal_reminder_7d_period_end', daysFrom: 5, daysTo: 7 },",
  "  { key: '1d', column: 'renewal_reminder_1d_period_end', daysFrom: 0, daysTo: 1 }",
  "];",
  "",
  "function fmtDate(d) {",
  "  try { return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }",
  "  catch (e) { return ''; }",
  "}",
  "function money(cents) { return '$' + (cents / 100).toFixed(2); }",
  "",
  "function htmlFor7d(user, info) {",
  "  const name  = user.name ? user.name.split(' ')[0] : 'there';",
  "  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +",
  "                '&t=' + encodeURIComponent(user.unsubscribe_token || '');",
  "  return '' +",
  "    '<div style=\"font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111\">' +",
  "      '<div style=\"font-size:22px;font-weight:800;padding:12px 4px\">' +",
  "        'TapMyCar<span style=\"color:#FF6B00\">.</span></div>' +",
  "      '<div style=\"background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:26px 24px\">' +",
  "        '<h1 style=\"font-size:18px;font-weight:800;margin:0 0 12px\">Heads up, ' + name + '  your TapMyCar plan renews in a week</h1>' +",
  "        '<p style=\"font-size:14px;line-height:1.65;color:#374151\">Your annual subscription renews on <b>' + info.dateStr + '</b>. We will charge <b>' + info.amountStr + '</b>' +",
  "          (info.card4 ? ' to your card ending in <b>' + info.card4 + '</b>' : ' to your card on file') + '.</p>' +",
  "        '<p style=\"font-size:14px;line-height:1.65;color:#374151\">Your tag stays active automatically  no action needed.</p>' +",
  "        '<p style=\"font-size:13px;line-height:1.6;color:#6B7280;margin-top:18px\">Want to update your card or cancel? Open Settings  Plan & Billing.</p>' +",
  "        '<p style=\"margin:22px 0 4px\"><a href=\"' + SITE + '/billing.html\" ' +",
  "          'style=\"background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +",
  "          'text-decoration:none;font-weight:700;font-size:14px\">Manage billing</a></p>' +",
  "      '</div>' +",
  "      '<div style=\"font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6\">' +",
  "        '<a href=\"' + unsub + '\" style=\"color:#9CA3AF\">Unsubscribe</a> &middot; Praman Tech LLC, Connecticut, USA' +",
  "      '</div>' +",
  "    '</div>';",
  "}",
  "",
  "function htmlFor1d(user, info) {",
  "  const name  = user.name ? user.name.split(' ')[0] : 'there';",
  "  const unsub = SITE + '/unsubscribe.html?u=' + encodeURIComponent(user.id) +",
  "                '&t=' + encodeURIComponent(user.unsubscribe_token || '');",
  "  return '' +",
  "    '<div style=\"font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111\">' +",
  "      '<div style=\"font-size:22px;font-weight:800;padding:12px 4px\">' +",
  "        'TapMyCar<span style=\"color:#FF6B00\">.</span></div>' +",
  "      '<div style=\"background:#fff;border:1px solid #FED7AA;border-left:4px solid #FF6B00;border-radius:14px;padding:26px 24px\">' +",
  "        '<h1 style=\"font-size:18px;font-weight:800;margin:0 0 12px;color:#C2410C\">Your plan renews tomorrow</h1>' +",
  "        '<p style=\"font-size:14px;line-height:1.65;color:#374151\">Hi ' + name + ', just a reminder: your annual TapMyCar subscription renews on <b>' + info.dateStr + '</b>.</p>' +",
  "        '<p style=\"font-size:14px;line-height:1.65;color:#374151\">We will charge <b>' + info.amountStr + '</b>' +",
  "          (info.card4 ? ' to your card ending in <b>' + info.card4 + '</b>' : ' to your card on file') + '.</p>' +",
  "        '<p style=\"font-size:13px;line-height:1.6;color:#6B7280;margin-top:18px\">No action needed. Want to make changes? Open Settings  Plan & Billing now.</p>' +",
  "        '<p style=\"margin:22px 0 4px\"><a href=\"' + SITE + '/billing.html\" ' +",
  "          'style=\"background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +",
  "          'text-decoration:none;font-weight:700;font-size:14px\">Manage billing</a></p>' +",
  "      '</div>' +",
  "      '<div style=\"font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6\">' +",
  "        '<a href=\"' + unsub + '\" style=\"color:#9CA3AF\">Unsubscribe</a> &middot; Praman Tech LLC, Connecticut, USA' +",
  "      '</div>' +",
  "    '</div>';",
  "}",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.headers.authorization !== ('Bearer ' + process.env.CRON_SECRET)) {",
  "    return res.status(401).json({ error: 'Unauthorized' });",
  "  }",
  "",
  "  /* Pull all users with an active subscription_id. Capped. */",
  "  const { data: users, error } = await supabase",
  "    .from('users')",
  "    .select('id, name, email, subscription_id, unsubscribe_token, email_opt_out, renewal_reminder_7d_period_end, renewal_reminder_1d_period_end')",
  "    .not('subscription_id', 'is', null)",
  "    .not('email', 'is', null)",
  "    .eq('email_opt_out', false)",
  "    .limit(CAP);",
  "",
  "  if (error) {",
  "    console.error('TMC_PATCH48 query error:', error.message);",
  "    return res.status(500).json({ error: error.message });",
  "  }",
  "  if (!users || users.length === 0) {",
  "    return res.json({ ok: true, scanned: 0, sent: 0 });",
  "  }",
  "",
  "  let scanned = 0, sent = 0, failed = 0, skippedAlreadySent = 0, skippedOutOfWindow = 0;",
  "",
  "  for (const u of users) {",
  "    scanned++;",
  "    let sub;",
  "    try {",
  "      sub = await stripe.subscriptions.retrieve(u.subscription_id, { expand: ['default_payment_method'] });",
  "    } catch (e) {",
  "      console.warn('TMC_PATCH48 sub retrieve failed for ' + u.id + ':', e && e.message);",
  "      continue;",
  "    }",
  "    if (!sub || !sub.current_period_end) continue;",
  "    if (sub.status !== 'active' && sub.status !== 'trialing') continue;",
  "",
  "    const periodEnd = new Date(sub.current_period_end * 1000);",
  "    const daysUntil = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);",
  "",
  "    const amount = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.unit_amount) || 0;",
  "    const card4  = (sub.default_payment_method && sub.default_payment_method.card && sub.default_payment_method.card.last4) || null;",
  "    const info = {",
  "      dateStr:   fmtDate(periodEnd),",
  "      amountStr: money(amount),",
  "      card4",
  "    };",
  "",
  "    for (const r of REMINDERS) {",
  "      if (daysUntil < r.daysFrom || daysUntil > r.daysTo) { skippedOutOfWindow++; continue; }",
  "      /* idempotency: did we already send for THIS period_end? */",
  "      const already = u[r.column];",
  "      if (already && new Date(already).getTime() === periodEnd.getTime()) {",
  "        skippedAlreadySent++;",
  "        continue;",
  "      }",
  "      const html    = (r.key === '7d') ? htmlFor7d(u, info) : htmlFor1d(u, info);",
  "      const subject = (r.key === '7d') ?",
  "        'Your TapMyCar plan renews in a week' :",
  "        'Your TapMyCar plan renews tomorrow';",
  "      try {",
  "        await resend.emails.send({ from: FROM, to: u.email, subject, html });",
  "        const update = {}; update[r.column] = periodEnd.toISOString();",
  "        await supabase.from('users').update(update).eq('id', u.id);",
  "        sent++;",
  "      } catch (e) {",
  "        console.warn('TMC_PATCH48 send failed for ' + u.email + ' [' + r.key + ']:', e && e.message);",
  "        failed++;",
  "      }",
  "    }",
  "  }",
  "",
  "  return res.json({ ok: true, scanned, sent, failed, skippedAlreadySent, skippedOutOfWindow });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * vercel.json cron entry: 11:00 UTC daily.
 * ======================================================================*/

const VJ_ANCHOR = [
  '    {',
  '      "path": "/api/cron-lapsed-email",',
  '      "schedule": "0 10 * * *"',
  '    }'
].join('\n');

const VJ_REPLACE = [
  '    {',
  '      "path": "/api/cron-lapsed-email",',
  '      "schedule": "0 10 * * *"',
  '    },',
  '    {',
  '      "path": "/api/cron-renewal-reminders",',
  '      "schedule": "0 11 * * *"',
  '    }'
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 48  renewal reminder emails\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* Cron file */
if (fs.existsSync(CRON_FILE) && fs.readFileSync(CRON_FILE, 'utf8').indexOf(MARKER) !== -1) {
  log(CRON_FILE + ': skip (already present with marker)');
} else {
  if (fs.existsSync(CRON_FILE)) {
    fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
    fs.copyFileSync(CRON_FILE, path.join(BACKUP_DIR, CRON_FILE));
  }
  fs.writeFileSync(CRON_FILE, CRON_BODY, 'utf8');
  try {
    execSync('node --check "' + CRON_FILE + '"', { stdio: 'pipe' });
    log(CRON_FILE + ': written, node --check OK');
    changed++;
  } catch (e) {
    fail('node --check FAILED for ' + CRON_FILE + '\n' + String(e.stderr || e.message));
  }
}

/* vercel.json */
const vj = fs.readFileSync(VERCEL, 'utf8');
if (vj.indexOf('/api/cron-renewal-reminders') !== -1) {
  log(VERCEL + ': skip (cron already listed)');
} else {
  const i = vj.indexOf(VJ_ANCHOR);
  if (i === -1) fail('vercel.json anchor NOT FOUND  expected /api/cron-lapsed-email entry');
  if (vj.indexOf(VJ_ANCHOR, i + 1) !== -1) fail('vercel.json anchor NOT UNIQUE');
  const nv = vj.replace(VJ_ANCHOR, VJ_REPLACE);
  /* validate JSON before writing */
  try {
    JSON.parse(nv);
  } catch (e) {
    fail('vercel.json would be invalid JSON after edit: ' + e.message);
  }
  backupAndWrite(VERCEL, vj, nv);
  log(VERCEL + ': cron entry added, JSON valid');
  changed++;
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  REQUIRED before deploy:');
  log('  1. Run patch48-migration.sql in Supabase first (adds the two tracking columns).');
  log('  2. After deploying, go to Stripe Dashboard  Settings  Customer emails');
  log('     and TURN OFF "Send emails for upcoming renewals" so customers');
  log('     do not get two reminders.\n');
  log('NEXT STEPS:');
  log('  1. SQL: run patch48-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 48: renewal reminder emails (7d + 1d cron)"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. Disable Stripe upcoming-invoice emails in Stripe Dashboard.');
  log('  6. Test by manually hitting the endpoint with your CRON_SECRET:');
  log('       Invoke-RestMethod -Uri https://www.tapmycar.io/api/cron-renewal-reminders');
  log('         -Method POST -Headers @{ Authorization = "Bearer <YOUR_CRON_SECRET>" }');
  log('     Expected output: { ok=True, scanned=N, sent=0, ... }. sent=0');
  log('     because no real user is currently within the 7d/1d window.\n');
}
