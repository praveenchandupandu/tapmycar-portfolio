/* ============================================================================
 * TapMyCar  Patch 52-fix  newsletter screen on the OTHER delete path too
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch52-fix.js
 *
 * Patch 52 hooked the post-delete newsletter signup screen into
 * declineRetentionOffer()  but that function only runs if the user clicks
 * "No thanks" in the retention offer modal. If the user had ALREADY used the
 * retention offer in a previous attempt, Patch 51b-fix correctly skips the
 * offer modal and falls back to the original delete code at the bottom of
 * submitPreDelete(). That original code does showToast + redirect to landing
 * with NO newsletter signup screen. So users on this path never see the
 * newsletter option.
 *
 * Fix: replicate the same two edits Patch 52 made in declineRetentionOffer(),
 * but in the original submitPreDelete() delete branch:
 *   1. Capture email/name BEFORE calling /api/delete-account.
 *   2. On success, call showPostDeleteSignup() instead of toast + redirect.
 *
 * One file modified: public/settings.html.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH52_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH52_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch52-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SETTINGS = path.join('public', 'settings.html');

/* ========================================================================
 * EDIT 1  capture email/name BEFORE the delete call.
 *   Anchor: the unique line just before the original-delete fetch.
 * ======================================================================*/

const CAPTURE_FIND = [
  "  } catch (e) { /* network error  fall through to delete */ }",
  "",
  "  go.disabled = true; go.textContent = 'Deleting…'; err.textContent = '';",
  "  try {",
  "    var res = await fetch('/api/delete-account', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},"
].join('\n');

const CAPTURE_REPLACE = [
  "  } catch (e) { /* network error  fall through to delete */ }",
  "",
  "  go.disabled = true; go.textContent = 'Deleting…'; err.textContent = '';",
  "",
  "  /* TMC_PATCH52_FIX: capture email/name now so the post-delete newsletter",
  "     signup screen can pre-fill them. We already have s.token; just fetch",
  "     /api/get-dashboard one more time before the row is wiped. */",
  "  try {",
  "    var __tmcTok2 = s.token || localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token');",
  "    var meRes2 = await fetch('/api/get-dashboard', { headers: { 'Authorization': 'Bearer ' + __tmcTok2 } });",
  "    if (meRes2.ok) {",
  "      var meData2 = await meRes2.json();",
  "      window.__tmcDelEmail = (meData2 && meData2.user && meData2.user.email) || '';",
  "      window.__tmcDelName  = (meData2 && meData2.user && meData2.user.name)  || '';",
  "    }",
  "  } catch (e) { /* non-fatal */ }",
  "",
  "  try {",
  "    var res = await fetch('/api/delete-account', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},"
].join('\n');

/* ========================================================================
 * EDIT 2  on delete success, show signup screen instead of toast+redirect.
 * ======================================================================*/

const SUCCESS_FIND = [
  "    var data = await res.json();",
  "    if (data.success) {",
  "      closePreDelete();",
  "      showToast('Account deleted. Goodbye!');",
  "      localStorage.clear();",
  "      setTimeout(function () { window.location.href = '/landing.html'; }, 1500);",
  "    } else {",
  "      go.disabled = false; go.textContent = 'Permanently delete';",
  "      err.textContent = data.error || 'Failed to delete. Please contact support@tapmycar.io.';",
  "    }"
].join('\n');

const SUCCESS_REPLACE = [
  "    var data = await res.json();",
  "    if (data.success) {",
  "      /* TMC_PATCH52_FIX: show post-delete newsletter signup screen. */",
  "      try { localStorage.clear(); } catch (e) {}",
  "      showPostDeleteSignup(",
  "        window.__tmcDelEmail || '',",
  "        window.__tmcDelName  || '',",
  "        reasonCode || ''",
  "      );",
  "    } else {",
  "      go.disabled = false; go.textContent = 'Permanently delete';",
  "      err.textContent = data.error || 'Failed to delete. Please contact support@tapmycar.io.';",
  "    }"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 52-fix  newsletter on the OTHER delete path\n');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(SETTINGS)) fail('settings.html not found');
const original = fs.readFileSync(SETTINGS, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SETTINGS + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const edits = [
  { label: 'capture email/name pre-delete',     find: CAPTURE_FIND, replace: CAPTURE_REPLACE },
  { label: 'success: show signup screen',       find: SUCCESS_FIND, replace: SUCCESS_REPLACE }
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

const s = fs.readFileSync(SETTINGS, 'utf8');
const at = s.indexOf('TMC_PATCH52_FIX: capture email');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p52-fix-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p52-fix-chk.js', { stdio: 'pipe' });
    log(SETTINGS + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(SETTINGS, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 52-fix: newsletter on already-used-offer delete path"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Test on a test account whose retention offer has already been used:');
log('     - Settings  Delete account  reason  Permanently delete');
log('     - NO retention offer modal (skipped, already used)');
log('     - Account deletes  NEW newsletter signup screen appears');
log('     - Subscribe or Skip works the same as the other delete path.\n');
