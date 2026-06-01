/* ============================================================================
 * TapMyCar  Patch 46-fix2  credit consumption bug + new renew.html
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch46-fix2.js
 *
 * Three pieces:
 *
 *   1. BUG FIX in api/create-checkout.js
 *      The credit-collection loop was greedy: it collected ALL pending+available
 *      row IDs even when only a fraction were needed for the transaction. The
 *      free-flow branch then marked every collected row consumed. Result: a
 *      single $9.99 renewal burned all $12 of your referral credit.
 *
 *      Fix: stop collecting once we have enough credit to cover the maximum
 *      we could possibly apply (chargeTodayCents). Any extra row stays
 *      untouched and remains spendable.
 *
 *   2. NEW PAGE public/renew.html
 *      Dedicated "Renew your annual plan" page. Shows:
 *        - the plan and the $9.99 (or $19.99) annual price
 *        - if user has referral credit: a checkbox to apply it, with the
 *          remaining-balance message identical in spirit to pricing.html
 *        - a single "Renew now" button that POSTs flow:'renew' with the
 *          checkbox state, then follows the Stripe URL or free-flow redirect.
 *
 *   3. Banner/modal in app-renewal-prompt.js now route to /renew.html instead
 *      of calling startRenew() directly. The user lands on the new page,
 *      sees the choice, then clicks Renew.
 *
 * No DB schema changes. Revert SQL for the 4 consumed credits is in
 * patch46-fix2-revert.sql (separate file, run in Supabase).
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH46_FIX2.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH46_FIX2';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch46-fix2-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC     = path.join('api', 'create-checkout.js');
const RENEW  = path.join('public', 'renew.html');
const SCRIPT = path.join('public', 'app-renewal-prompt.js');

/* ========================================================================
 * EDIT 1  api/create-checkout.js  FIFO consumption stops at needed amount
 *
 * The greedy block iterates `usable` and pushes every row's id into
 * _tmcCreditRowIds. We add a stop-at-needed condition: figure out the
 * maximum credit that could be applied for this transaction (which depends
 * on chargeTodayCents and the $1 floor / fullCoverFlows rule), and stop
 * once _tmcCreditCents >= that maximum.
 *
 * However at the point of the loop we don't yet know fullCoverFlows-derived
 * maxApply  that's computed AFTER the loop. We solve this by computing
 * maxApply up-front, before the loop, using the same formula.
 * ======================================================================*/

const CC_FIND = [
  "    const applyCredit = req.body.apply_referral_credit !== false; /* default ON */",
  "    let _tmcCreditCents = 0;",
  "    let _tmcCreditRowIds = [];",
  "    if (applyCredit) {",
  "      const nowIso = new Date().toISOString();",
  "      const { data: avRows } = await supabase",
  "        .from('referrals')",
  "        .select('id, credit_amount, status, available_at')",
  "        .eq('referrer_user_id', user_id)",
  "        .in('status', ['pending','available'])",
  "        .order('paid_at', { ascending: true });",
  "      const usable = (avRows || []).filter(r =>",
  "        r.status === 'available' ||",
  "        (r.status === 'pending' && r.available_at && r.available_at <= nowIso)",
  "      );",
  "      for (const r of usable) {",
  "        _tmcCreditCents += Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "        _tmcCreditRowIds.push(r.id);",
  "      }",
  "    }"
].join('\n');

const CC_REPLACE = [
  "    const applyCredit = req.body.apply_referral_credit !== false; /* default ON */",
  "    let _tmcCreditCents = 0;",
  "    let _tmcCreditRowIds = [];",
  "    if (applyCredit) {",
  "      /* TMC_PATCH46_FIX2: stop collecting at the amount we could possibly",
  "         use for this transaction. Without this, a $9.99 renewal would",
  "         consume $12 of credit (all 4 rows) because the consume step",
  "         flips every collected row.",
  "         maxApply mirrors the math used below the loop. */",
  "      const _tmcFullCover  = (flow === 'renew' || flow === 'upgrade');",
  "      const _tmcMaxApply   = _tmcFullCover ? chargeTodayCents : Math.max(0, chargeTodayCents - 100);",
  "      const nowIso = new Date().toISOString();",
  "      const { data: avRows } = await supabase",
  "        .from('referrals')",
  "        .select('id, credit_amount, status, available_at')",
  "        .eq('referrer_user_id', user_id)",
  "        .in('status', ['pending','available'])",
  "        .order('paid_at', { ascending: true });",
  "      const usable = (avRows || []).filter(r =>",
  "        r.status === 'available' ||",
  "        (r.status === 'pending' && r.available_at && r.available_at <= nowIso)",
  "      );",
  "      for (const r of usable) {",
  "        if (_tmcCreditCents >= _tmcMaxApply) break;",
  "        _tmcCreditCents += Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "        _tmcCreditRowIds.push(r.id);",
  "      }",
  "    }"
].join('\n');

/* ========================================================================
 * EDIT 2  app-renewal-prompt.js  modal+banner route to /renew.html
 *
 * Replace startRenew() and the click handlers to navigate to /renew.html
 * instead of calling the API directly. We pass plan via query string.
 * ======================================================================*/

const PR_FIND = [
  "  /* TMC_PATCH46_FIX: post flow:'renew' so the user pays the annual",
  "     subscription fee (not the sticker price). Plan comes from the user",
  "     object cached by init(). The returned Stripe URL is followed",
  "     immediately. On failure, fall back to /pricing.html so the user has",
  "     SOMETHING actionable. */",
  "  function startRenew() {",
  "    var token = getToken();",
  "    var plan  = (window.__tmcRenewalUser && window.__tmcRenewalUser.plan) || 'standard';",
  "    if (!token) { window.location.href = '/signin.html'; return; }",
  "    fetch('/api/create-checkout', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },",
  "      body: JSON.stringify({ user_id: token, flow: 'renew', plan: plan })",
  "    })",
  "      .then(function (r) { return r.json(); })",
  "      .then(function (d) {",
  "        if (d && d.free === true && d.redirect) {",
  "          window.location.href = d.redirect;",
  "          return;",
  "        }",
  "        if (d && d.url) { window.location.href = d.url; return; }",
  "        /* unexpected response  bounce to pricing as a safety net */",
  "        window.location.href = '/pricing.html';",
  "      })",
  "      .catch(function () { window.location.href = '/pricing.html'; });",
  "  }"
].join('\n');

const PR_REPLACE = [
  "  /* TMC_PATCH46_FIX2: route to the new /renew.html page so the user",
  "     can see the price + credit balance + apply checkbox BEFORE we hit",
  "     create-checkout. Plan passed as a query string param. */",
  "  function startRenew() {",
  "    var plan = (window.__tmcRenewalUser && window.__tmcRenewalUser.plan) || 'standard';",
  "    window.location.href = '/renew.html?plan=' + encodeURIComponent(plan);",
  "  }"
].join('\n');

/* ========================================================================
 * FILE 3 NEW  public/renew.html
 * ======================================================================*/

const RENEW_BODY = [
  "<!DOCTYPE html>",
  "<!-- TMC_PATCH46_FIX2 renew.html -->",
  "<html lang=\"en\">",
  "<head>",
  "  <meta charset=\"UTF-8\">",
  "  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
  "  <title>Renew  TapMyCar</title>",
  "  <link rel=\"icon\" href=\"/favicon.png\">",
  "  <style>",
  "    *{box-sizing:border-box}",
  "    body{font-family:Inter,system-ui,-apple-system,Arial,sans-serif;margin:0;background:#fff;color:#111;-webkit-font-smoothing:antialiased}",
  "    .wrap{max-width:480px;margin:0 auto;padding:18px 16px 32px}",
  "    .header{display:flex;align-items:center;gap:10px;padding:6px 0 18px}",
  "    .back{font-size:20px;background:transparent;border:0;cursor:pointer;color:#111}",
  "    .header h1{font-size:18px;font-weight:800;margin:0;flex:1}",
  "    .card{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:18px;margin-top:12px;box-shadow:0 1px 2px rgba(0,0,0,0.02)}",
  "    .plan-name{font-size:13px;font-weight:700;color:#6B7280;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px}",
  "    .plan-price{font-size:28px;font-weight:800;color:#FF6B00}",
  "    .plan-sub{font-size:12px;color:#6B7280;margin-top:4px}",
  "    .credit-row{display:flex;gap:10px;align-items:flex-start;padding:14px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;margin-top:14px;cursor:pointer;user-select:none}",
  "    .credit-row input{margin-top:2px;flex-shrink:0;width:16px;height:16px;accent-color:#16A34A;cursor:pointer}",
  "    .credit-row .label{flex:1;font-size:13px;color:#166534;line-height:1.5}",
  "    .credit-row .label b{font-weight:800;color:#15803D}",
  "    .credit-row .label .note{display:block;font-size:11px;color:#15803D;margin-top:4px;font-weight:500;opacity:0.85}",
  "    .total{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0 8px;border-top:1px solid #F3F4F6;margin-top:14px}",
  "    .total .label{font-size:13px;color:#6B7280;font-weight:600}",
  "    .total .amount{font-size:24px;font-weight:800;color:#111}",
  "    .btn{width:100%;padding:14px;background:#FF6B00;color:#fff;border:0;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;margin-top:14px}",
  "    .btn:disabled{opacity:0.55;cursor:wait}",
  "    .disclose{font-size:11px;color:#9CA3AF;line-height:1.55;margin-top:12px;text-align:center}",
  "    .err{color:#DC2626;font-size:12px;margin-top:10px;display:none}",
  "    .err.show{display:block}",
  "  </style>",
  "</head>",
  "<body>",
  "  <div class=\"wrap\">",
  "    <div class=\"header\">",
  "      <button type=\"button\" class=\"back\" onclick=\"history.back()\" aria-label=\"Back\">&lsaquo;</button>",
  "      <h1>Renew your subscription</h1>",
  "    </div>",
  "",
  "    <div class=\"card\">",
  "      <div class=\"plan-name\" id=\"plan-label\">Standard  annual plan</div>",
  "      <div class=\"plan-price\" id=\"plan-price\">$9.99</div>",
  "      <div class=\"plan-sub\">Reactivates your existing tag for one year</div>",
  "",
  "      <label class=\"credit-row\" id=\"credit-row\" style=\"display:none\">",
  "        <input type=\"checkbox\" id=\"apply-credit\">",
  "        <span class=\"label\">",
  "          <b>You have <span id=\"credit-balance\">$0.00</span> in referral credit.</b>",
  "          <span class=\"note\" id=\"credit-note\">Tick to apply your credit to this renewal.</span>",
  "        </span>",
  "      </label>",
  "",
  "      <div class=\"total\">",
  "        <div class=\"label\">You'll pay today</div>",
  "        <div class=\"amount\" id=\"pay-amount\">$9.99</div>",
  "      </div>",
  "",
  "      <button type=\"button\" class=\"btn\" id=\"renew-btn\" onclick=\"doRenew()\">Renew now</button>",
  "      <div class=\"err\" id=\"err\"></div>",
  "      <div class=\"disclose\">Your card will be saved for next year's autopay. Cancel anytime in Settings. 14-day refund window applies.</div>",
  "    </div>",
  "  </div>",
  "",
  "<script>",
  "/* TMC_PATCH46_FIX2 renew.html logic. Pulls credit balance from",
  "   /api/get-referral, computes the live total based on the apply-credit",
  "   checkbox, then POSTs flow:'renew' with explicit apply_referral_credit. */",
  "(function () {",
  "  'use strict';",
  "  var PLAN_PRICES = { standard: 999, premium: 1999 }; /* cents */",
  "  var PLAN_NAMES  = { standard: 'Standard  annual plan', premium: 'Premium  annual plan' };",
  "",
  "  function getToken() {",
  "    try { return localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token'); }",
  "    catch (e) { return null; }",
  "  }",
  "  function fmt(c) { return '$' + (c / 100).toFixed(2); }",
  "",
  "  var qs = new URLSearchParams(window.location.search);",
  "  var plan = qs.get('plan') || 'standard';",
  "  if (!PLAN_PRICES[plan]) plan = 'standard';",
  "  var priceCents = PLAN_PRICES[plan];",
  "  var creditCents = 0;",
  "",
  "  document.getElementById('plan-label').textContent = PLAN_NAMES[plan];",
  "  document.getElementById('plan-price').textContent = fmt(priceCents);",
  "  document.getElementById('pay-amount').textContent = fmt(priceCents);",
  "",
  "  function recomputeTotal() {",
  "    var apply = document.getElementById('apply-credit').checked;",
  "    var note  = document.getElementById('credit-note');",
  "    if (!apply || creditCents <= 0) {",
  "      document.getElementById('pay-amount').textContent = fmt(priceCents);",
  "      note.textContent = 'Tick to apply your credit to this renewal.';",
  "      return;",
  "    }",
  "    var applied  = Math.min(creditCents, priceCents);",
  "    var finalDue = priceCents - applied;",
  "    var leftover = creditCents - applied;",
  "    document.getElementById('pay-amount').textContent = fmt(finalDue);",
  "    if (leftover > 0) {",
  "      note.textContent = fmt(applied) + ' applied. ' + fmt(leftover) +",
  "        ' remains in your account for future transactions.';",
  "    } else if (applied < priceCents) {",
  "      note.textContent = fmt(applied) + ' applied. You\\'ll pay ' + fmt(finalDue) + ' today.';",
  "    } else {",
  "      note.textContent = fmt(applied) + ' fully covers this renewal. No charge today.';",
  "    }",
  "  }",
  "",
  "  function loadCredit() {",
  "    var token = getToken();",
  "    if (!token) return;",
  "    fetch('/api/get-referral', { headers: { 'Authorization': 'Bearer ' + token } })",
  "      .then(function (r) { return r.ok ? r.json() : null; })",
  "      .then(function (d) {",
  "        if (!d || !d.success) return;",
  "        var avail = (typeof d.credit_available === 'number') ? d.credit_available : 0;",
  "        if (avail <= 0) return;",
  "        creditCents = Math.round(avail * 100);",
  "        document.getElementById('credit-balance').textContent = '$' + avail.toFixed(2);",
  "        document.getElementById('credit-row').style.display = 'flex';",
  "        document.getElementById('apply-credit').addEventListener('change', recomputeTotal);",
  "      })",
  "      .catch(function () {});",
  "  }",
  "",
  "  window.doRenew = function () {",
  "    var token = getToken();",
  "    if (!token) { window.location.href = '/signin.html'; return; }",
  "    var apply = document.getElementById('apply-credit').checked;",
  "    var btn = document.getElementById('renew-btn');",
  "    var err = document.getElementById('err');",
  "    btn.disabled = true; btn.textContent = 'Loading...';",
  "    err.classList.remove('show');",
  "",
  "    fetch('/api/create-checkout', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },",
  "      body: JSON.stringify({",
  "        user_id: token,",
  "        flow: 'renew',",
  "        plan: plan,",
  "        apply_referral_credit: !!apply",
  "      })",
  "    })",
  "      .then(function (r) { return r.json(); })",
  "      .then(function (d) {",
  "        if (d && d.free === true && d.redirect) {",
  "          window.location.href = d.redirect;",
  "          return;",
  "        }",
  "        if (d && d.url) {",
  "          window.location.href = d.url;",
  "          return;",
  "        }",
  "        btn.disabled = false; btn.textContent = 'Renew now';",
  "        err.textContent = (d && d.error) || 'Could not start renewal. Please try again.';",
  "        err.classList.add('show');",
  "      })",
  "      .catch(function () {",
  "        btn.disabled = false; btn.textContent = 'Renew now';",
  "        err.textContent = 'Network error. Please try again.';",
  "        err.classList.add('show');",
  "      });",
  "  };",
  "",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', loadCredit);",
  "  } else { loadCredit(); }",
  "})();",
  "</script>",
  "</body>",
  "</html>",
  ""
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 46-fix2  credit consumption bug + new renew.html\n');
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
  if (patchFile(CC, [
    { label: 'create-checkout: FIFO stop-at-needed', find: CC_FIND, replace: CC_REPLACE }
  ])) {
    execSync('node --check "' + CC + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }

  if (patchFile(SCRIPT, [
    { label: 'app-renewal-prompt: route to /renew.html', find: PR_FIND, replace: PR_REPLACE }
  ])) {
    execSync('node --check "' + SCRIPT + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }

  /* New renew.html. */
  if (fs.existsSync(RENEW) && fs.readFileSync(RENEW, 'utf8').indexOf(MARKER) !== -1) {
    log(RENEW + ': skip (already present with marker)');
  } else {
    if (fs.existsSync(RENEW)) {
      fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
      fs.copyFileSync(RENEW, path.join(BACKUP_DIR, RENEW));
    }
    fs.writeFileSync(RENEW, RENEW_BODY, 'utf8');
    /* syntax-check the embedded <script> */
    const s = fs.readFileSync(RENEW, 'utf8');
    const i = s.indexOf('TMC_PATCH46_FIX2 renew.html logic');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p46-fix2-renew-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p46-fix2-renew-chk.js', { stdio: 'pipe' });
    }
    log(RENEW + ': written, node --check OK');
    changed++;
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  ALSO run patch46-fix2-revert.sql in Supabase to restore');
  log('your 4 consumed referral credits to available.\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 46-fix2: credit consumption bug + renew.html"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Run the SQL revert in Supabase (separate file).');
  log('  5. Hard-refresh /dashboard.html. Click the yellow banner OR the');
  log('     modal Renew now. You should land on /renew.html showing:');
  log('       - Standard annual plan, $9.99');
  log('       - Credit row: $12.00 in referral credit (checkbox)');
  log('       - Pay today: $9.99 (or $0 if ticked)');
  log('     Click Renew now with checkbox UNticked -> Stripe page at $9.99.');
  log('     Click Renew now with checkbox TICKED -> free flow, only enough');
  log('     credit rows consumed to cover $9.99 (not all of them).\n');
}
