/* ============================================================================
 * TapMyCar  Patch 53-fix  track successful refunds + admin view
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch53-fix.js
 *
 * Builds on Patch 53. Adds:
 *
 *   1. SQL  three new columns on orders to record successful refunds.
 *   2. cancel-subscription.js  on successful refund, write those columns
 *      (refund_succeeded_at, refund_amount_cents, refund_stripe_id).
 *   3. /api/admin-failed-refunds  rebrand internally as "/api/admin-refunds"
 *      We KEEP the existing URL for backward compatibility, but it now
 *      returns BOTH failed and successful refunds, with a clear `status`
 *      field on each row.
 *   4. Admin UI  re-render the Refunds panel to show failed first
 *      (urgent), successful below (audit), with a date-range filter
 *      defaulting to last 30 days, cap 100 successful entries.
 *
 * No new sidebar item. Same Refunds tab, richer content.
 *
 * Files:
 *   - patch53-fix-migration.sql       NEW
 *   - api/cancel-subscription.js      one new write block
 *   - api/admin-failed-refunds.js     rewritten to include successful refunds
 *   - public/cmshaveaccesstouser2026-npmevy.html  panel + JS updated
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH53_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH53_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch53-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC          = path.join('api', 'cancel-subscription.js');
const ADMIN_EP    = path.join('api', 'admin-failed-refunds.js');
const ADMIN_HTML  = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * EDIT 1  cancel-subscription.js  on success, record the refund.
 * Anchor: the lines that already set refundId/refundAmountCents.
 * ======================================================================*/

const CC_FIND = [
  "        refundIssued = true;",
  "        refundAmountCents = refund.amount;",
  "        refundId = refund.id;",
  "        console.log('Refund issued ' + refund.id + ' for $' + (refund.amount / 100).toFixed(2));"
].join('\n');

const CC_REPLACE = [
  "        refundIssued = true;",
  "        refundAmountCents = refund.amount;",
  "        refundId = refund.id;",
  "        console.log('Refund issued ' + refund.id + ' for $' + (refund.amount / 100).toFixed(2));",
  "        /* TMC_PATCH53_FIX: record on the most recent order so admin can see */",
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
  "              refund_succeeded_at:  new Date().toISOString(),",
  "              refund_amount_cents:  refund.amount,",
  "              refund_stripe_id:     refund.id",
  "            }).eq('id', lastOrder.id);",
  "          }",
  "        } catch (e) { console.warn('p53-fix: refund success record failed:', e && e.message); }"
].join('\n');

/* ========================================================================
 * EDIT 2  admin-failed-refunds.js  rewritten to include successful too.
 * We replace the whole file body  it's small.
 * ======================================================================*/

const ADMIN_EP_BODY = [
  "// TMC_PATCH53_FIX admin endpoint: list both failed AND successful refunds.",
  "// URL kept as /api/admin-failed-refunds for backward compatibility.",
  "// Query params:",
  "//   include_resolved=1   show failed refunds that have been resolved too",
  "//   days=30              days back for successful refunds (default 30)",
  "//   limit=100            cap on successful refunds (default 100)",
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
  "  const q = req.query || {};",
  "  const includeResolved = q.include_resolved === '1';",
  "  const days = Math.min(parseInt(q.days || '30', 10) || 30, 365);",
  "  const limit = Math.min(parseInt(q.limit || '100', 10) || 100, 200);",
  "  const since = new Date(Date.now() - days * 86400000).toISOString();",
  "",
  "  /* Failed refunds */",
  "  let qFailed = supabase.from('orders')",
  "    .select('id, user_id, amount, stripe_id, subscription_id, refund_failed_at, refund_error_message, refund_failed_resolved_at, refund_failed_resolved_by, created_at')",
  "    .not('refund_failed_at', 'is', null)",
  "    .order('refund_failed_at', { ascending: false })",
  "    .limit(100);",
  "  if (!includeResolved) qFailed = qFailed.is('refund_failed_resolved_at', null);",
  "",
  "  /* Successful refunds (within the requested window) */",
  "  const qSuccess = supabase.from('orders')",
  "    .select('id, user_id, amount, stripe_id, subscription_id, refund_succeeded_at, refund_amount_cents, refund_stripe_id, created_at')",
  "    .not('refund_succeeded_at', 'is', null)",
  "    .gte('refund_succeeded_at', since)",
  "    .order('refund_succeeded_at', { ascending: false })",
  "    .limit(limit);",
  "",
  "  const [failedRes, successRes] = await Promise.all([qFailed, qSuccess]);",
  "  if (failedRes.error)  return res.status(500).json({ error: failedRes.error.message });",
  "  if (successRes.error) return res.status(500).json({ error: successRes.error.message });",
  "",
  "  const failedRows  = failedRes.data  || [];",
  "  const successRows = successRes.data || [];",
  "  const userIds = Array.from(new Set([...failedRows, ...successRows].map(o => o.user_id))).filter(Boolean);",
  "",
  "  let userById = {};",
  "  if (userIds.length > 0) {",
  "    const { data: users } = await supabase",
  "      .from('users')",
  "      .select('id, name, email')",
  "      .in('id', userIds);",
  "    (users || []).forEach(u => { userById[u.id] = u; });",
  "  }",
  "",
  "  const failed = failedRows.map(o => ({",
  "    status: o.refund_failed_resolved_at ? 'failed_resolved' : 'failed_open',",
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
  "  const success = successRows.map(o => ({",
  "    status: 'succeeded',",
  "    order_id: o.id,",
  "    user: userById[o.user_id] || { id: o.user_id, name: null, email: null },",
  "    original_amount_cents: o.amount || 0,",
  "    refund_amount_cents:   o.refund_amount_cents || 0,",
  "    refund_stripe_id:      o.refund_stripe_id,",
  "    subscription_id:       o.subscription_id,",
  "    refund_succeeded_at:   o.refund_succeeded_at,",
  "    created_at:            o.created_at",
  "  }));",
  "",
  "  return res.json({ ok: true, failed, success, window_days: days });",
  "};",
  ""
].join('\n');

/* ========================================================================
 * EDIT 3  admin HTML  the existing loadFailedRefunds() function rendered",
 * one list. Replace it to render two stacked sections: Failed (open) on top,",
 * Successful below. Also tweak the panel markup: add a days-window selector",
 * (30 / 90 / 365 days).",
 * ======================================================================*/

/* The panel markup we wrote in Patch 53-admin-ui  we need to replace the",
   list+checkbox area with a richer structure. Anchor on the unique id of",
   the existing list. */
const PANEL_FIND = [
  '          <div id="refunds-list" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden"></div>',
  '          <label style="display:inline-flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:#6B7280;cursor:pointer">',
  '            <input type="checkbox" id="refunds-include-resolved" onchange="loadFailedRefunds()">',
  '            <span>Include already-resolved entries</span>',
  '          </label>'
].join('\n');

const PANEL_REPLACE = [
  '          <!-- TMC_PATCH53_FIX -->',
  '          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:14px;font-size:12px;color:#6B7280">',
  '            <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">',
  '              <input type="checkbox" id="refunds-include-resolved" onchange="loadFailedRefunds()">',
  '              <span>Include resolved failures</span>',
  '            </label>',
  '            <span style="display:inline-flex;align-items:center;gap:6px">',
  '              <span>Successful refunds in last</span>',
  '              <select id="refunds-window" onchange="loadFailedRefunds()" style="font-size:12px;padding:4px 6px;border-radius:6px;border:1px solid #D1D5DB">',
  '                <option value="30" selected>30 days</option>',
  '                <option value="90">90 days</option>',
  '                <option value="365">1 year</option>',
  '              </select>',
  '            </span>',
  '          </div>',
  '',
  '          <div id="refunds-failed-wrap" style="margin-bottom:18px"></div>',
  '          <div id="refunds-success-wrap"></div>'
].join('\n');

/* Replace the entire loadFailedRefunds function in one shot to avoid the
   stale-anchor problem from sequential in-memory edits. We anchor from the
   marker comment all the way through the closing brace before resolveRefund. */

const JS_FIND = [
  '/* TMC_PATCH53_ADMIN: failed-refunds tab logic. */',
  'async function loadFailedRefunds() {',
  '  const list = document.getElementById("refunds-list");',
  '  const navCount = document.getElementById("refunds-nav-count");',
  '  if (!list) return;',
  '  list.innerHTML = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading...</div>\';',
  '  const includeResolved = !!(document.getElementById("refunds-include-resolved") && document.getElementById("refunds-include-resolved").checked);',
  '  try {',
  '    const res = await fetch("/api/admin-failed-refunds" + (includeResolved ? "?include_resolved=1" : ""));',
  '    if (!res.ok) throw new Error("admin auth required");',
  '    const data = await res.json();',
  '    const orders = (data && data.orders) || [];',
  '    /* Update the small red badge on the nav  unresolved count only. */',
  '    if (navCount) {',
  '      const unresolved = orders.filter(function (o) { return !o.resolved; }).length;',
  '      if (unresolved > 0) { navCount.textContent = String(unresolved); navCount.style.display = "inline-block"; }',
  '      else                { navCount.style.display = "none"; }',
  '    }',
  '    if (orders.length === 0) {',
  '      list.innerHTML = \'<div style="padding:24px;font-size:13px;color:#6B7280;text-align:center">No failed refunds. \\u2728</div>\';',
  '      return;',
  '    }',
  '    list.innerHTML = orders.map(function (o, i) {',
  '      const border = (i < orders.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '      const userName  = (o.user && (o.user.name || o.user.email)) || o.user.id || "unknown user";',
  '      const userEmail = (o.user && o.user.email) || "";',
  '      const amount = "$" + ((o.amount_cents || 0) / 100).toFixed(2);',
  '      const when   = o.refund_failed_at ? new Date(o.refund_failed_at).toLocaleString() : "";',
  '      const err    = (o.refund_error_message || "").replace(/</g, "&lt;");',
  '      const statusBadge = o.resolved',
  '        ? \'<span style="background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Resolved</span>\'',
  '        : \'<span style="background:#FEE2E2;color:#7F1D1D;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Open</span>\';',
  '      const actionBtn = o.resolved',
  '        ? \'\'',
  '        : \'<button type="button" onclick="resolveRefund(\\\'\' + o.order_id + \'\\\')" style="background:#FF6B00;color:#fff;border:0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Mark resolved</button>\';',
  '      return \'<div style="padding:14px;\' + border + \'">\' +',
  '        \'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">\' +',
  '          \'<div style="flex:1;min-width:0">\' +',
  '            \'<div style="font-size:13px;font-weight:700;color:#111">\' + userName + \'</div>\' +',
  '            (userEmail && userEmail !== userName ? \'<div style="font-size:11px;color:#6B7280">\' + userEmail + \'</div>\' : "") +',
  '          \'</div>\' +',
  '          \'<div style="font-size:14px;font-weight:800;color:#111">\' + amount + \'</div>\' +',
  '          statusBadge +',
  '        \'</div>\' +',
  '        \'<div style="font-size:11px;color:#6B7280;margin-bottom:8px">\' + when + \' &middot; order \' + o.order_id.slice(0,8) + \'</div>\' +',
  '        \'<div style="background:#FEF2F2;border:1px solid #FECACA;padding:8px 10px;border-radius:8px;font-size:11px;color:#7F1D1D;font-family:ui-monospace,monospace;word-break:break-word;line-height:1.5;margin-bottom:8px">\' + (err || "(no error message)") + \'</div>\' +',
  '        actionBtn +',
  '      \'</div>\';',
  '    }).join("");',
  '  } catch (e) {',
  '    list.innerHTML = \'<div style="padding:18px;font-size:13px;color:#DC2626;text-align:center">Could not load failed refunds.</div>\';',
  '  }',
  '}'
].join('\n');

const JS_REPLACE = [
  '/* TMC_PATCH53_FIX: refunds tab now shows BOTH failed and successful. */',
  'async function loadFailedRefunds() {',
  '  const failedWrap  = document.getElementById("refunds-failed-wrap");',
  '  const successWrap = document.getElementById("refunds-success-wrap");',
  '  const navCount    = document.getElementById("refunds-nav-count");',
  '  if (!failedWrap || !successWrap) return;',
  '  failedWrap.innerHTML  = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading failed refunds...</div>\';',
  '  successWrap.innerHTML = \'<div style="padding:18px;font-size:13px;color:#6B7280;text-align:center">Loading successful refunds...</div>\';',
  '  const includeResolved = !!(document.getElementById("refunds-include-resolved") && document.getElementById("refunds-include-resolved").checked);',
  '  const win = (document.getElementById("refunds-window") && document.getElementById("refunds-window").value) || "30";',
  '  try {',
  '    const url = "/api/admin-failed-refunds?days=" + encodeURIComponent(win) + (includeResolved ? "&include_resolved=1" : "");',
  '    const res = await fetch(url);',
  '    if (!res.ok) throw new Error("admin auth required");',
  '    const data = await res.json();',
  '    const failed  = (data && data.failed)  || [];',
  '    const success = (data && data.success) || [];',
  '    if (navCount) {',
  '      const unresolved = failed.filter(function (o) { return !o.resolved; }).length;',
  '      if (unresolved > 0) { navCount.textContent = String(unresolved); navCount.style.display = "inline-block"; }',
  '      else                { navCount.style.display = "none"; }',
  '    }',
  '    failedWrap.innerHTML  = renderFailedRefunds(failed);',
  '    successWrap.innerHTML = renderSuccessRefunds(success, win);',
  '  } catch (e) {',
  '    failedWrap.innerHTML  = \'<div style="padding:18px;font-size:13px;color:#DC2626;text-align:center">Could not load refunds.</div>\';',
  '    successWrap.innerHTML = "";',
  '  }',
  '}',
  '',
  'function renderFailedRefunds(rows) {',
  '  const title = \'<div style="font-size:11px;font-weight:700;color:#7F1D1D;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px">Failed refunds (need attention)</div>\';',
  '  if (!rows || rows.length === 0) {',
  '    return title + \'<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px;font-size:13px;color:#6B7280;text-align:center">No failed refunds. \\u2728</div>\';',
  '  }',
  '  const inner = rows.map(function (o, i) {',
  '    const border = (i < rows.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '    const userName  = (o.user && (o.user.name || o.user.email)) || o.user.id || "unknown user";',
  '    const userEmail = (o.user && o.user.email) || "";',
  '    const amount = "$" + ((o.amount_cents || 0) / 100).toFixed(2);',
  '    const when   = o.refund_failed_at ? new Date(o.refund_failed_at).toLocaleString() : "";',
  '    const err    = (o.refund_error_message || "").replace(/</g, "&lt;");',
  '    const statusBadge = o.resolved',
  '      ? \'<span style="background:#D1FAE5;color:#065F46;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Resolved</span>\'',
  '      : \'<span style="background:#FEE2E2;color:#7F1D1D;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase">Open</span>\';',
  '    const actionBtn = o.resolved',
  '      ? \'\'',
  '      : \'<button type="button" onclick="resolveRefund(\\\'\' + o.order_id + \'\\\')" style="background:#FF6B00;color:#fff;border:0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Mark resolved</button>\';',
  '    return \'<div style="padding:14px;\' + border + \'">\' +',
  '      \'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">\' +',
  '        \'<div style="flex:1;min-width:0">\' +',
  '          \'<div style="font-size:13px;font-weight:700;color:#111">\' + userName + \'</div>\' +',
  '          (userEmail && userEmail !== userName ? \'<div style="font-size:11px;color:#6B7280">\' + userEmail + \'</div>\' : "") +',
  '        \'</div>\' +',
  '        \'<div style="font-size:14px;font-weight:800;color:#111">\' + amount + \'</div>\' +',
  '        statusBadge +',
  '      \'</div>\' +',
  '      \'<div style="font-size:11px;color:#6B7280;margin-bottom:8px">\' + when + \' &middot; order \' + o.order_id.slice(0,8) + \'</div>\' +',
  '      \'<div style="background:#FEF2F2;border:1px solid #FECACA;padding:8px 10px;border-radius:8px;font-size:11px;color:#7F1D1D;font-family:ui-monospace,monospace;word-break:break-word;line-height:1.5;margin-bottom:8px">\' + (err || "(no error message)") + \'</div>\' +',
  '      actionBtn +',
  '    \'</div>\';',
  '  }).join("");',
  '  return title + \'<div style="background:#fff;border:1px solid #FECACA;border-radius:14px;overflow:hidden">\' + inner + \'</div>\';',
  '}',
  '',
  'function renderSuccessRefunds(rows, win) {',
  '  const title = \'<div style="font-size:11px;font-weight:700;color:#065F46;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:8px">Successful refunds (last \' + win + \' days)</div>\';',
  '  if (!rows || rows.length === 0) {',
  '    return title + \'<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px;font-size:13px;color:#6B7280;text-align:center">No successful refunds in this window.</div>\';',
  '  }',
  '  const inner = rows.map(function (o, i) {',
  '    const border = (i < rows.length - 1) ? "border-bottom:1px solid #F3F4F6;" : "";',
  '    const userName  = (o.user && (o.user.name || o.user.email)) || o.user.id || "unknown user";',
  '    const userEmail = (o.user && o.user.email) || "";',
  '    const refundAmt = "$" + ((o.refund_amount_cents || 0) / 100).toFixed(2);',
  '    const when      = o.refund_succeeded_at ? new Date(o.refund_succeeded_at).toLocaleString() : "";',
  '    const stripeRef = o.refund_stripe_id ? \' &middot; \' + o.refund_stripe_id : "";',
  '    return \'<div style="padding:14px;\' + border + \'">\' +',
  '      \'<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">\' +',
  '        \'<div style="flex:1;min-width:0">\' +',
  '          \'<div style="font-size:13px;font-weight:700;color:#111">\' + userName + \'</div>\' +',
  '          (userEmail && userEmail !== userName ? \'<div style="font-size:11px;color:#6B7280">\' + userEmail + \'</div>\' : "") +',
  '        \'</div>\' +',
  '        \'<div style="font-size:14px;font-weight:800;color:#065F46">-\' + refundAmt + \'</div>\' +',
  '      \'</div>\' +',
  '      \'<div style="font-size:11px;color:#6B7280">\' + when + stripeRef + \'</div>\' +',
  '    \'</div>\';',
  '  }).join("");',
  '  return title + \'<div style="background:#fff;border:1px solid #D1FAE5;border-radius:14px;overflow:hidden">\' + inner + \'</div>\';',
  '}'
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 53-fix  successful refunds in admin Refunds tab\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* cancel-subscription.js */
{
  const original = fs.readFileSync(CC, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(CC + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    const i = updated.indexOf(CC_FIND);
    if (i === -1) fail('pattern NOT FOUND in ' + CC);
    if (updated.indexOf(CC_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + CC);
    updated = updated.replace(CC_FIND, () => CC_REPLACE);
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(CC, original, updated);
    execSync('node --check "' + CC + '"', { stdio: 'pipe' });
    log(CC + ': patched, node --check OK');
    changed++;
  }
}

/* admin-failed-refunds.js: full rewrite */
{
  const original = fs.existsSync(ADMIN_EP) ? fs.readFileSync(ADMIN_EP, 'utf8') : '';
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_EP + ': skip (already patched)');
  } else {
    if (fs.existsSync(ADMIN_EP)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
      fs.copyFileSync(ADMIN_EP, path.join(BACKUP_DIR, ADMIN_EP));
    }
    fs.writeFileSync(ADMIN_EP, ADMIN_EP_BODY, 'utf8');
    execSync('node --check "' + ADMIN_EP + '"', { stdio: 'pipe' });
    log(ADMIN_EP + ': rewritten, node --check OK');
    changed++;
  }
}

/* admin HTML: panel + JS edits */
{
  const original = fs.readFileSync(ADMIN_HTML, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_HTML + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');

    const edits = [
      { label: 'panel markup',  find: PANEL_FIND, replace: PANEL_REPLACE },
      { label: 'JS full func',  find: JS_FIND,    replace: JS_REPLACE    }
    ];
    for (const e of edits) {
      const i = updated.indexOf(e.find);
      if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
      if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
      updated = updated.replace(e.find, () => e.replace);
    }
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(ADMIN_HTML, original, updated);

    /* syntax-check the embedded script block */
    const s = fs.readFileSync(ADMIN_HTML, 'utf8');
    const at = s.indexOf('TMC_PATCH53_FIX: refunds tab now shows');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p53-fix-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p53-fix-chk.js', { stdio: 'pipe' });
        log(ADMIN_HTML + ': patched, node --check OK');
      } catch (e) {
        fs.writeFileSync(ADMIN_HTML, original, 'utf8');
        fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
      }
    }
    changed++;
  }
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  REQUIRED before deploy:');
  log('  Run patch53-fix-migration.sql in Supabase first (3 new columns).');
  log('  Without it, successful refunds will NOT record (silent log warning).\n');
  log('NEXT STEPS:');
  log('  1. Run patch53-fix-migration.sql in Supabase');
  log('  2. git add -A');
  log('  3. git commit -m "Patch 53-fix: successful refunds in admin"');
  log('  4. git push  (wait ~60s for Vercel)');
  log('  5. Open admin Refunds tab. Two sections:');
  log('       - Failed refunds (need attention)  red border');
  log('       - Successful refunds (last N days)  green border');
  log('     Window selector lets you switch 30d / 90d / 1y.\n');
}
