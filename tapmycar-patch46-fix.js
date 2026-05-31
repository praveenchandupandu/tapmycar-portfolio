/* ============================================================================
 * TapMyCar  Patch 46-fix  renewal CTA goes to flow=renew, not pricing.html
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch46-fix.js
 *
 * Patch 46 sent the modal/banner click to /pricing.html, which is the
 * "buy a sticker" page. A user with an already-active tag but no card on
 * file doesn't need a sticker  they need to pay the annual subscription
 * fee on their existing tag. Different flow.
 *
 * Your codebase already supports this exactly: flow:'renew' on
 * /api/create-checkout charges only the annual fee, with a Stripe line item
 * labeled "Reactivate your tag · annual plan". The dashboard already has
 * a function p35dStartRenew() that calls it; we re-use the same pattern.
 *
 * One file modified: public/app-renewal-prompt.js. The modal's "Renew now"
 * button and the banner's body click both now POST to /api/create-checkout
 * with flow:'renew' and redirect to the returned Stripe URL.
 *
 * Plan picked from the user object returned by /api/get-dashboard.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH46_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH46_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch46-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SCRIPT = path.join('public', 'app-renewal-prompt.js');

/* =====================================================================
 * EDIT 1  add a startRenew() helper before the IIFE's `function init()`.
 * It posts flow:'renew' to /api/create-checkout and follows the returned
 * Stripe URL. Plan is read from a closure variable set in init().
 * Then update the modal's "Renew now" button and the banner-body click
 * to call startRenew() instead of window.location.href = '/pricing.html'.
 * ===================================================================*/

const FIND_INIT = "  function init() {";
const REPLACE_INIT = [
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
  "  }",
  "",
  "  function init() {"
].join('\n');

/* Cache the user object so startRenew() knows the plan */
const FIND_INIT_BODY = [
  "      .then(function (d) {",
  "        if (!d || !shouldShow(d.user)) return;",
  "        injectBanner();"
].join('\n');

const REPLACE_INIT_BODY = [
  "      .then(function (d) {",
  "        if (!d || !shouldShow(d.user)) return;",
  "        window.__tmcRenewalUser = d.user; /* TMC_PATCH46_FIX: cache plan */",
  "        injectBanner();"
].join('\n');

/* Banner click  startRenew() instead of pricing.html */
const FIND_BANNER_CLICK = "      window.location.href = '/pricing.html';\n    });\n\n    /* Insert at top of body (below the sticky header if any). The header";
const REPLACE_BANNER_CLICK = "      startRenew(); /* TMC_PATCH46_FIX */\n    });\n\n    /* Insert at top of body (below the sticky header if any). The header";

/* Modal "Renew now" button  startRenew() instead of pricing.html */
const FIND_MODAL_PAY = "    document.getElementById('tmc-modal-pay').addEventListener('click', function () {\n      window.location.href = '/pricing.html';\n    });";
const REPLACE_MODAL_PAY = "    document.getElementById('tmc-modal-pay').addEventListener('click', function () {\n      startRenew(); /* TMC_PATCH46_FIX */\n    });";

/* =====================================================================
 * DRIVER
 * ===================================================================*/

log('\nTapMyCar  Patch 46-fix  route renewal CTA to flow=renew\n');

if (!fs.existsSync(SCRIPT)) fail('expected file not found: ' + SCRIPT + '\n(Did Patch 46 deploy?)');
const original = fs.readFileSync(SCRIPT, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SCRIPT + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const edits = [
  { label: 'add startRenew helper before init',    find: FIND_INIT,         replace: REPLACE_INIT },
  { label: 'cache user object in init()',          find: FIND_INIT_BODY,    replace: REPLACE_INIT_BODY },
  { label: 'banner click  startRenew',            find: FIND_BANNER_CLICK, replace: REPLACE_BANNER_CLICK },
  { label: 'modal Renew now button  startRenew',  find: FIND_MODAL_PAY,    replace: REPLACE_MODAL_PAY }
];
for (const e of edits) {
  const i = updated.indexOf(e.find);
  if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
  if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
  updated = updated.replace(e.find, () => e.replace);
}
if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(SCRIPT, path.join(BACKUP_DIR, SCRIPT));
fs.writeFileSync(SCRIPT, updated, 'utf8');

try {
  execSync('node --check "' + SCRIPT + '"', { stdio: 'pipe' });
  log(SCRIPT + ': patched (4 edits), node --check OK');
} catch (e) {
  fs.writeFileSync(SCRIPT, original, 'utf8');
  fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 46-fix: renewal CTA uses flow=renew not pricing"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Hard-refresh /dashboard.html. Modal appears (or banner if you');
log('     already dismissed the modal earlier in this session).');
log('     Click "Renew now" or click the banner body  Stripe page opens');
log('     with line item "TapMyCar Standard  annual plan (reactivate');
log('     your tag)" for $9.99, NOT a $9.99 sticker.\n');
