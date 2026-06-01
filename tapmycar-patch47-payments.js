/* ============================================================================
 * TapMyCar  Patch 47-payments  payment history in settings
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch47-payments.js
 *
 * Adds a "Payment history" section to settings.html showing the user's past
 * orders. Each row: date, what it was for, total paid, and (when relevant)
 * a credit-vs-cash breakdown.
 *
 * Two files:
 *
 *   1. api/get-orders-history.js  NEW endpoint.
 *      Returns the caller's own orders, last 20, newest first. Joins the
 *      referrals table on consumed_order_id to compute the credit amount
 *      applied to each order. Output shape:
 *        {
 *          ok: true,
 *          orders: [
 *            {
 *              id, created_at, order_status, plan,
 *              amount_cents,       // what Stripe was charged
 *              credit_cents,       // what referral credit was applied
 *              total_cents,        // amount + credit (the "real" price)
 *              free                // true if entirely paid by credit
 *            },
 *            ...
 *          ]
 *        }
 *      Uses resolveUser() for auth, same pattern as other endpoints.
 *
 *   2. public/settings.html  new "Payment history" section.
 *      Lists up to 5 rows by default. "See all" expands to all 20.
 *      Each row: date  what  $total  (small subtitle if credit was used)
 *
 * SAFE TO RE-RUN: skipped if files already contain TMC_PATCH47_PAYMENTS.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH47_PAYMENTS';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch47-payments-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const ENDPOINT = path.join('api', 'get-orders-history.js');
const SETTINGS = path.join('public', 'settings.html');

/* ========================================================================
 * FILE 1  NEW: api/get-orders-history.js
 * ======================================================================*/

const ENDPOINT_BODY = [
  "// TMC_PATCH47_PAYMENTS",
  "// Returns the authenticated user's own order history with credit-vs-cash",
  "// breakdown. Last 20 orders, newest first.",
  "",
  "const { createClient } = require('@supabase/supabase-js');",
  "const { resolveUser } = require('./_auth');",
  "",
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);",
  "",
  "module.exports = async function handler(req, res) {",
  "  try {",
  "    const user = await resolveUser(req);",
  "    if (!user) return res.status(401).json({ error: 'Unauthorized' });",
  "",
  "    const { data: orders, error } = await supabase",
  "      .from('orders')",
  "      .select('id, created_at, order_status, plan, amount, stripe_id, sticker_count')",
  "      .eq('user_id', user.id)",
  "      .order('created_at', { ascending: false })",
  "      .limit(20);",
  "    if (error) return res.status(500).json({ error: error.message });",
  "",
  "    if (!orders || orders.length === 0) {",
  "      return res.json({ ok: true, orders: [] });",
  "    }",
  "",
  "    /* Pull referral consumptions for these orders so we can show credit",
  "       applied. Only rows with consumed_order_id are useful here. */",
  "    const orderIds = orders.map(o => o.id);",
  "    const { data: creditRows } = await supabase",
  "      .from('referrals')",
  "      .select('consumed_order_id, credit_amount')",
  "      .in('consumed_order_id', orderIds);",
  "",
  "    const creditByOrder = {};",
  "    (creditRows || []).forEach(function (r) {",
  "      if (!r.consumed_order_id) return;",
  "      const cents = Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "      creditByOrder[r.consumed_order_id] = (creditByOrder[r.consumed_order_id] || 0) + cents;",
  "    });",
  "",
  "    const out = orders.map(function (o) {",
  "      const amountCents = parseInt(o.amount || 0, 10) || 0;",
  "      const creditCents = creditByOrder[o.id] || 0;",
  "      return {",
  "        id: o.id,",
  "        created_at: o.created_at,",
  "        order_status: o.order_status,",
  "        plan: o.plan,",
  "        amount_cents:  amountCents,",
  "        credit_cents:  creditCents,",
  "        total_cents:   amountCents + creditCents,",
  "        free:          amountCents === 0 && creditCents > 0,",
  "        sticker_count: o.sticker_count || 0",
  "      };",
  "    });",
  "",
  "    return res.json({ ok: true, orders: out });",
  "  } catch (e) {",
  "    console.error('get-orders-history error:', e && e.message);",
  "    return res.status(500).json({ error: 'Internal error' });",
  "  }",
  "};",
  ""
].join('\n');

/* ========================================================================
 * FILE 2  settings.html  add "Payment history" section
 *   Anchor: insert AFTER the REFERRALS section's closing div and BEFORE the
 *   "Cancel subscription" row. We need a unique nearby string.
 * ======================================================================*/

/* Find the "Cancel subscription" anchor. Then we insert our section right
   before its outer container. The container starts with a `class=\"row\"` so
   we find the unique pattern by searching for the cancel-subscription label. */
const SET_FIND = "  <!-- Cancel Subscription (only shown if user has an active subscription) -->";

const SET_REPLACE = [
  "  <!-- TMC_PATCH47_PAYMENTS: payment history section -->",
  "  <div class=\"sl\" id=\"payments-label\" style=\"display:none\">Payment history</div>",
  "  <div id=\"payments-section\" style=\"display:none\">",
  "    <div id=\"payments-list\" style=\"background:#fff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden\"></div>",
  "    <button type=\"button\" id=\"payments-toggle\" onclick=\"togglePayments()\"",
  "      style=\"display:none;width:100%;background:transparent;border:0;padding:10px;margin-top:8px;font-size:12px;font-weight:600;color:#FF6B00;cursor:pointer\">See all</button>",
  "  </div>",
  "",
  "  <!-- Cancel Subscription (only shown if user has an active subscription) -->"
].join('\n');

/* And the JS: extend the existing loadSettings flow with loadPayments(). We
   inject right after `loadSettings();` is invoked, which is a unique anchor. */
const SET_JS_FIND = "loadSettings();";
const SET_JS_REPLACE = [
  "loadSettings();",
  "",
  "/* TMC_PATCH47_PAYMENTS: payment history rendering. */",
  "var __tmcPaymentsExpanded = false;",
  "var __tmcPayments = [];",
  "",
  "function fmtMoney(cents) { return '$' + (cents / 100).toFixed(2); }",
  "function fmtPaymentDate(iso) {",
  "  try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }",
  "  catch (e) { return ''; }",
  "}",
  "function paymentTitle(o) {",
  "  var status = (o.order_status || '').toLowerCase();",
  "  if (status === 'renewal')    return 'Annual renewal  ' + (o.plan ? o.plan : '');",
  "  if (status === 'upgrade')    return 'Plan upgrade  Premium';",
  "  if (status === 'direct')     return (o.plan === 'premium' ? 'Premium' : 'Standard') + ' sticker';",
  "  if (status === 'processing') return 'Order processing  ' + (o.plan || '');",
  "  return 'Order  ' + (o.plan || '');",
  "}",
  "function paymentSubtitle(o) {",
  "  if (o.free)                                return 'Paid with referral credit';",
  "  if (o.credit_cents > 0 && o.amount_cents > 0) return fmtMoney(o.credit_cents) + ' credit + ' + fmtMoney(o.amount_cents) + ' card';",
  "  return null;",
  "}",
  "function renderPayments() {",
  "  var list = document.getElementById('payments-list');",
  "  var toggle = document.getElementById('payments-toggle');",
  "  var section = document.getElementById('payments-section');",
  "  var label = document.getElementById('payments-label');",
  "  if (!list || !section) return;",
  "  if (__tmcPayments.length === 0) {",
  "    section.style.display = 'none';",
  "    if (label) label.style.display = 'none';",
  "    return;",
  "  }",
  "  section.style.display = 'block';",
  "  if (label) label.style.display = 'block';",
  "  var visible = __tmcPaymentsExpanded ? __tmcPayments : __tmcPayments.slice(0, 5);",
  "  list.innerHTML = visible.map(function (o, i) {",
  "    var sub = paymentSubtitle(o);",
  "    var amount = o.free ? '$0.00' : fmtMoney(o.amount_cents);",
  "    var border = (i < visible.length - 1) ? 'border-bottom:1px solid #F3F4F6;' : '';",
  "    return '<div style=\"display:flex;align-items:center;gap:12px;padding:14px;' + border + '\">' +",
  "      '<div style=\"flex:1;min-width:0\">' +",
  "        '<div style=\"font-size:13px;font-weight:700;color:#111\">' + paymentTitle(o) + '</div>' +",
  "        '<div style=\"font-size:11px;color:#6B7280;margin-top:2px\">' + fmtPaymentDate(o.created_at) + (sub ? '  ' + sub : '') + '</div>' +",
  "      '</div>' +",
  "      '<div style=\"font-size:14px;font-weight:800;color:#111\">' + amount + '</div>' +",
  "    '</div>';",
  "  }).join('');",
  "  if (__tmcPayments.length > 5) {",
  "    toggle.style.display = 'block';",
  "    toggle.textContent = __tmcPaymentsExpanded ? 'Show less' : ('See all ' + __tmcPayments.length);",
  "  } else { toggle.style.display = 'none'; }",
  "}",
  "function togglePayments() {",
  "  __tmcPaymentsExpanded = !__tmcPaymentsExpanded;",
  "  renderPayments();",
  "}",
  "async function loadPayments() {",
  "  try {",
  "    var res = await fetch('/api/get-orders-history');",
  "    if (!res.ok) return;",
  "    var data = await res.json();",
  "    if (!data || !data.ok || !Array.isArray(data.orders)) return;",
  "    __tmcPayments = data.orders;",
  "    renderPayments();",
  "  } catch (e) {}",
  "}",
  "loadPayments();"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 47-payments  payment history in settings\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* Endpoint */
if (fs.existsSync(ENDPOINT) && fs.readFileSync(ENDPOINT, 'utf8').indexOf(MARKER) !== -1) {
  log(ENDPOINT + ': skip (already present with marker)');
} else {
  if (fs.existsSync(ENDPOINT)) {
    fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
    fs.copyFileSync(ENDPOINT, path.join(BACKUP_DIR, ENDPOINT));
  }
  fs.writeFileSync(ENDPOINT, ENDPOINT_BODY, 'utf8');
  execSync('node --check "' + ENDPOINT + '"', { stdio: 'pipe' });
  log(ENDPOINT + ': written, node --check OK');
  changed++;
}

/* Settings: two edits */
if (!fs.existsSync(SETTINGS)) fail('expected file not found: ' + SETTINGS);
const original = fs.readFileSync(SETTINGS, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SETTINGS + ': skip (already patched)');
} else {
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');

  const edits = [
    { label: 'settings: insert section',  find: SET_FIND,    replace: SET_REPLACE },
    { label: 'settings: insert JS hooks', find: SET_JS_FIND, replace: SET_JS_REPLACE }
  ];
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

  backupAndWrite(SETTINGS, original, updated);

  /* syntax-check the script block we touched */
  const s = fs.readFileSync(SETTINGS, 'utf8');
  const at = s.indexOf('TMC_PATCH47_PAYMENTS: payment history rendering');
  if (at !== -1) {
    const a = s.lastIndexOf('<script>', at) + 8;
    const b = s.indexOf('</script>', at);
    fs.writeFileSync('/tmp/p47-chk.js', s.slice(a, b));
    try {
      execSync('node --check /tmp/p47-chk.js', { stdio: 'pipe' });
      log(SETTINGS + ': patched, node --check OK');
    } catch (e) {
      fs.writeFileSync(SETTINGS, original, 'utf8');
      fail('node --check FAILED  settings.html restored.\n' + String(e.stderr || e.message));
    }
  }
  changed++;
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 47-payments: payment history in settings"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Hard-refresh /settings.html  scroll to a new');
  log('     "PAYMENT HISTORY" section. You should see your sql_backdoor');
  log('     order at $1.00 from Apr 30, labeled "Standard sticker".\n');
}
