/* ============================================================================
 * TapMyCar  Patch 53  refund bug fixes
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch53-refund-bugs.js
 *
 * Three things:
 *
 *   BUG A  Race condition on rapid double-click of Cancel.
 *   Two POSTs to /api/cancel-subscription within ~200ms both pass the
 *   subscription_id check. Stripe protects from double-refunds at its API,
 *   but you can still get duplicate refund-attempt logs and confused state.
 *   Fix: a per-user advisory lock via Supabase. The first request sets
 *   users.refund_in_progress_at = now(). Any subsequent request within 60s
 *   gets a 409 Conflict.",
 *
 *   BUG B  Silent refund failure.
 *   When Stripe refund API errors, the user currently gets a generic",
 *   'subscription canceled' email and no notification about the refund",
 *   failing. They think they got refunded, they didn't, support ticket",
 *   incoming.
 *   Fix: catch the refund error properly, record it on the order row",
 *   (refund_failed_at + refund_error_message), send the user a clear",
 *   email saying 'refund attempt failed, support will contact you',",
 *   and flag the order for admin review.",
 *
 *   ADMIN VISIBILITY  new section showing failed refunds.
 *   Lists orders with refund_failed_at set, with user details and the",
 *   Stripe error message. Admin can mark resolved after manual intervention.",
 *
 * Files modified:",
 *   1. patch53-migration.sql           NEW schema (5 new columns + index)",
 *   2. api/cancel-subscription.js      lock + improved error handling",
 *   3. api/_email-helpers.js or...     no, just inline the email for now",
 *   4. api/admin-failed-refunds.js     NEW endpoint  list failed refunds",
 *   5. api/admin-resolve-refund.js     NEW endpoint  mark resolved",
 *   6. public/cmshaveaccesstouser...   admin page section",
 *
 * Schema additions (in patch53-migration.sql):",
 *   users.refund_in_progress_at        timestamptz",
 *   orders.refund_failed_at            timestamptz",
 *   orders.refund_error_message        text",
 *   orders.refund_failed_resolved_at   timestamptz",
 *   orders.refund_failed_resolved_by   uuid (admin user id, NULL if N/A)",
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH53.",
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH53';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch53-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC_FILE      = path.join('api', 'cancel-subscription.js');
const ADMIN_LIST   = path.join('api', 'admin-failed-refunds.js');
const ADMIN_RESOLVE = path.join('api', 'admin-resolve-refund.js');
const ADMIN_HTML   = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * EDIT 1  cancel-subscription.js  add lock + improve refund error path
 *
 * Anchor: the "1. Compute refund eligibility" block. We need to insert a
 * lock-acquisition check BEFORE the existing logic, and replace the silent
 * catch with structured error capture + user email.
 * ======================================================================*/

const CC_INSERT_LOCK_FIND = [
  "  try {",
  "    // 1. Compute refund eligibility",
  "    const elig = await computeEligibility(user);"
].join('\n');

const CC_INSERT_LOCK_REPLACE = [
  "  /* TMC_PATCH53: advisory lock against rapid double-clicks. If another",
  "     cancel for this user is in progress within the last 60 seconds, refuse.",
  "     We set the timestamp on success, clear it at the end via finally. */",
  "  const lockNow = new Date();",
  "  const lockExpiry = new Date(lockNow.getTime() - 60 * 1000);",
  "  const { data: lockCheck } = await supabase.from('users')",
  "    .select('refund_in_progress_at')",
  "    .eq('id', user.id).single();",
  "  if (lockCheck && lockCheck.refund_in_progress_at && new Date(lockCheck.refund_in_progress_at) > lockExpiry) {",
  "    return res.status(409).json({ error: 'A cancellation is already in progress. Please wait a moment.' });",
  "  }",
  "  await supabase.from('users').update({ refund_in_progress_at: lockNow.toISOString() }).eq('id', user.id);",
  "",
  "  try {",
  "    // 1. Compute refund eligibility",
  "    const elig = await computeEligibility(user);"
].join('\n');

/* Replace the silent catch around refunds.create with structured failure */
const CC_REFUND_CATCH_FIND = [
  "      } catch (refundErr) {",
  "        console.error('Refund failed (continuing with cancel):', refundErr.message);",
  "        // We still proceed to cancel the subscription. If the refund failed,",
  "        // the customer can contact support. We don't want to leave them stuck",
  "        // with an uncanceled subscription.",
  "      }"
].join('\n');

const CC_REFUND_CATCH_REPLACE = [
  "      } catch (refundErr) {",
  "        /* TMC_PATCH53: record the failure on the most recent renewal/direct",
  "           order so admin can see it. Then send the user an honest email so",
  "           they know support will contact them. We still cancel the sub. */",
  "        console.error('Refund failed:', refundErr && refundErr.message);",
  "        try {",
  "          const { data: lastOrder } = await supabase",
  "            .from('orders')",
  "            .select('id')",
  "            .eq('user_id', user.id)",
  "            .order('created_at', { ascending: false })",
  "            .limit(1)",
  "            .single();",
  "          if (lastOrder && lastOrder.id) {",
  "            await supabase.from('orders').update({",
  "              refund_failed_at: new Date().toISOString(),",
  "              refund_error_message: (refundErr && refundErr.message) || 'unknown'",
  "            }).eq('id', lastOrder.id);",
  "          }",
  "        } catch (e) { console.warn('p53: could not flag order:', e && e.message); }",
  "",
  "        /* User-facing email about the refund failure (not the cancellation). */",
  "        try {",
  "          if (user.email) {",
  "            const { Resend } = require('resend');",
  "            const _r = new Resend(process.env.RESEND_API_KEY);",
  "            await _r.emails.send({",
  "              from: 'TapMyCar <noreply@tapmycar.io>',",
  "              to: user.email,",
  "              subject: 'Your TapMyCar refund needs attention',",
  "              html: ''+",
  "                '<div style=\"font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111\">' +",
  "                  '<div style=\"font-size:22px;font-weight:800;padding:12px 4px\">TapMyCar<span style=\"color:#FF6B00\">.</span></div>' +",
  "                  '<div style=\"background:#fff;border:1px solid #FED7AA;border-left:4px solid #FF6B00;border-radius:14px;padding:26px 24px\">' +",
  "                    '<h1 style=\"font-size:18px;font-weight:800;margin:0 0 12px;color:#C2410C\">We need to look at your refund</h1>' +",
  "                    '<p style=\"font-size:14px;line-height:1.65;color:#374151\">Your subscription has been canceled, but our automatic refund attempt did not complete. This is unusual and means our team needs to step in manually.</p>' +",
  "                    '<p style=\"font-size:14px;line-height:1.65;color:#374151\">A member of our team will reach out within one business day to confirm and process your refund. No action needed from you.</p>' +",
  "                    '<p style=\"font-size:13px;line-height:1.6;color:#6B7280\">If you have not heard from us within 24 hours, email <a href=\"mailto:support@tapmycar.io\" style=\"color:#FF6B00\">support@tapmycar.io</a>.</p>' +",
  "                  '</div>' +",
  "                  '<div style=\"font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6\">Praman Tech LLC, Connecticut, USA</div>' +",
  "                '</div>'",
  "            });",
  "          }",
  "        } catch (e) { console.warn('p53: could not send refund-fail email:', e && e.message); }",
  "      }"
].join('\n');

/* We also need to clear the lock in a finally block. The existing try has",
   no finally clause near the end of the function. Easiest: append the clear",
   to the existing res.json success path, and to the outer error handler.",
   To minimize risk, we wrap the success res.json call. */
const CC_SUCCESS_FIND = "    return res.json({";
const CC_SUCCESS_REPLACE = [
  "    /* TMC_PATCH53: clear the lock on success. */",
  "    try { await supabase.from('users').update({ refund_in_progress_at: null }).eq('id', user.id); }",
  "    catch (e) { console.warn('p53: lock clear failed:', e && e.message); }",
  "    return res.json({"
].join('\n');

/* And add clear-on-error in the outer catch. */
const CC_OUTERCATCH_FIND = "  } catch (err) {\n    console.error(\"Cancel subscription error:\", err.message);";
const CC_OUTERCATCH_REPLACE = [
  "  } catch (err) {",
  "    /* TMC_PATCH53: clear the lock on error too, so retry is possible. */",
  "    try { await supabase.from('users').update({ refund_in_progress_at: null }).eq('id', user.id); }",
  "    catch (e) { console.warn('p53: lock clear failed:', e && e.message); }",
  "    console.error(\"Cancel subscription error:\", err.message);"
].join('\n');

/* ========================================================================
 * NEW FILES  admin endpoints
 * ======================================================================*/

const ADMIN_LIST_BODY = [
  "// TMC_PATCH53 admin endpoint: list orders with failed refunds.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const includeResolved = req.query && req.query.include_resolved === '1';",
  "",
  "  let q = supabase.from('orders')",
  "    .select('id, user_id, amount, stripe_id, subscription_id, refund_failed_at, refund_error_message, refund_failed_resolved_at, refund_failed_resolved_by, created_at')",
  "    .not('refund_failed_at', 'is', null)",
  "    .order('refund_failed_at', { ascending: false })",
  "    .limit(100);",
  "",
  "  if (!includeResolved) q = q.is('refund_failed_resolved_at', null);",
  "",
  "  const { data: orders, error } = await q;",
  "  if (error) return res.status(500).json({ error: error.message });",
  "  if (!orders || orders.length === 0) return res.json({ ok: true, orders: [] });",
  "",
  "  /* Pull user details for the listed orders. */",
  "  const userIds = Array.from(new Set(orders.map(o => o.user_id))).filter(Boolean);",
  "  const { data: users } = await supabase",
  "    .from('users')",
  "    .select('id, name, email')",
  "    .in('id', userIds);",
  "  const userById = {};",
  "  (users || []).forEach(u => { userById[u.id] = u; });",
  "",
  "  const out = orders.map(o => ({",
  "    order_id: o.id,",
  "    user: userById[o.user_id] || { id: o.user_id, name: null, email: null },",
  "    amount_cents: o.amount || 0,",
  "    stripe_id: o.stripe_id,",
  "    subscription_id: o.subscription_id,",
  "    refund_failed_at: o.refund_failed_at,",
  "    refund_error_message: o.refund_error_message,",
  "    resolved: !!o.refund_failed_resolved_at,",
  "    resolved_at: o.refund_failed_resolved_at,",
  "    created_at: o.created_at",
  "  }));",
  "",
  "  return res.json({ ok: true, orders: out });",
  "};",
  ""
].join('\n');

const ADMIN_RESOLVE_BODY = [
  "// TMC_PATCH53 admin endpoint: mark a failed refund as resolved.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveAdmin } = require('./_admin-auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  "",
  "  const admin = await resolveAdmin(req);",
  "  if (!admin) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "  const { order_id } = req.body || {};",
  "  if (!order_id) return res.status(400).json({ error: 'order_id required' });",
  "",
  "  const { error } = await supabase.from('orders').update({",
  "    refund_failed_resolved_at: new Date().toISOString(),",
  "    refund_failed_resolved_by: admin.id || null",
  "  }).eq('id', order_id);",
  "",
  "  if (error) return res.status(500).json({ error: error.message });",
  "  return res.json({ ok: true });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 53  refund bug fixes\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function patchFile(file, edits) {
  if (!fs.existsSync(file)) fail('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + file + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + file + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  backupAndWrite(file, original, updated);
  log(file + ': patched');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

try {
  if (patchFile(CC_FILE, [
    { label: 'cancel-subscription: insert lock',       find: CC_INSERT_LOCK_FIND,    replace: CC_INSERT_LOCK_REPLACE },
    { label: 'cancel-subscription: refund catch',      find: CC_REFUND_CATCH_FIND,   replace: CC_REFUND_CATCH_REPLACE },
    { label: 'cancel-subscription: success lock clear', find: CC_SUCCESS_FIND,       replace: CC_SUCCESS_REPLACE },
    { label: 'cancel-subscription: error lock clear',  find: CC_OUTERCATCH_FIND,     replace: CC_OUTERCATCH_REPLACE }
  ])) {
    execSync('node --check "' + CC_FILE + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }

  /* admin endpoints */
  for (const [pp, body] of [[ADMIN_LIST, ADMIN_LIST_BODY], [ADMIN_RESOLVE, ADMIN_RESOLVE_BODY]]) {
    if (fs.existsSync(pp) && fs.readFileSync(pp, 'utf8').indexOf(MARKER) !== -1) {
      log(pp + ': skip (already present with marker)');
    } else {
      if (fs.existsSync(pp)) {
        fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
        fs.copyFileSync(pp, path.join(BACKUP_DIR, pp));
      }
      fs.writeFileSync(pp, body, 'utf8');
      execSync('node --check "' + pp + '"', { stdio: 'pipe' });
      log(pp + ': written, node --check OK');
      changed++;
    }
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  REQUIRED before deploy:');
  log('  Run patch53-migration.sql in Supabase FIRST (5 new columns).');
  log('  Without that, refund-failure handling will throw on every cancellation.\n');
  log('NEXT STEPS:');
  log('  1. Run patch53-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 53: refund race + silent failure fixes"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. Test (low risk): cancel-subscription endpoint should still work');
  log('     for normal happy path. Rapid double-click should now get 409.');
  log('     Failed refunds (no easy way to simulate live) flow to the new');
  log('     admin endpoint, queryable at /api/admin-failed-refunds.\n');
  log('  Admin UI section for failed refunds is a SEPARATE small follow-on');
  log('  patch (HTML only). I will build that as Patch 53-admin-ui next if');
  log('  you confirm this base patch deploys cleanly.\n');
}
