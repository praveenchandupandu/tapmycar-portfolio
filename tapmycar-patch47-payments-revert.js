/* ============================================================================
 * TapMyCar  Patch 47-payments-revert  remove payment history from settings
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch47-payments-revert.js
 *
 * Per your decision: billing.html already has a Payment History section.
 * Having a second one on settings.html is duplication. This patch removes
 * the section I added to settings.html earlier in Patch 47-payments,
 * leaving billing.html as the single source of truth.
 *
 * Two files modified:
 *   1. public/settings.html  remove the section markup and the JS block.
 *   2. api/get-orders-history.js  DELETED (not used anywhere else).
 *
 * SAFE TO RE-RUN: settings.html skipped if it no longer contains the
 * TMC_PATCH47_PAYMENTS markers.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch47-payments-revert-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SETTINGS = path.join('public', 'settings.html');
const ENDPOINT = path.join('api', 'get-orders-history.js');

/* ========================================================================
 * EDIT 1  remove the section markup
 * ======================================================================*/

const SET_SECTION_FIND = [
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

const SET_SECTION_REPLACE = "  <!-- Cancel Subscription (only shown if user has an active subscription) -->";

/* ========================================================================
 * EDIT 2  remove the JS block
 * ======================================================================*/

const SET_JS_FIND = [
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

const SET_JS_REPLACE = "loadSettings();";

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 47-payments-revert  remove duplicate payment history\n');
log('Backup -> ' + BACKUP_DIR + '\n');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (!fs.existsSync(SETTINGS)) fail('settings.html not found');
const original = fs.readFileSync(SETTINGS, 'utf8');

if (original.indexOf('TMC_PATCH47_PAYMENTS') === -1) {
  log(SETTINGS + ': skip (already reverted / never patched)');
} else {
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');

  const edits = [
    { label: 'settings: remove section', find: SET_SECTION_FIND, replace: SET_SECTION_REPLACE },
    { label: 'settings: remove JS block', find: SET_JS_FIND,      replace: SET_JS_REPLACE }
  ];
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

  fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
  fs.copyFileSync(SETTINGS, path.join(BACKUP_DIR, SETTINGS));
  fs.writeFileSync(SETTINGS, updated, 'utf8');

  /* syntax-check the script block */
  const s = fs.readFileSync(SETTINGS, 'utf8');
  const at = s.indexOf('loadSettings();');
  if (at !== -1) {
    const a = s.lastIndexOf('<script>', at) + 8;
    const b = s.indexOf('</script>', at);
    fs.writeFileSync('/tmp/p47-revert-chk.js', s.slice(a, b));
    try {
      execSync('node --check /tmp/p47-revert-chk.js', { stdio: 'pipe' });
      log(SETTINGS + ': reverted, node --check OK');
    } catch (e) {
      fs.writeFileSync(SETTINGS, original, 'utf8');
      fail('node --check FAILED  settings.html restored.\n' + String(e.stderr || e.message));
    }
  }
}

/* Delete the unused endpoint. */
if (fs.existsSync(ENDPOINT)) {
  fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
  fs.copyFileSync(ENDPOINT, path.join(BACKUP_DIR, ENDPOINT));
  fs.unlinkSync(ENDPOINT);
  log(ENDPOINT + ': deleted');
} else {
  log(ENDPOINT + ': skip (already deleted)');
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Revert Patch 47-payments (use billing.html instead)"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Run the cleanup SQL block (separate text), then continue.\n');
