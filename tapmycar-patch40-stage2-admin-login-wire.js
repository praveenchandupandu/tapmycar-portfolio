/* ============================================================================
 * TapMyCar  Patch 40  Stage 2  admin login/logout use the httpOnly cookie
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch40-stage2-admin-login-wire.js
 *
 * Wires the admin page's login + logout to the Stage 1 endpoints, so a real
 * admin login now ALSO establishes the signed httpOnly session cookie.
 *
 * STRICTLY ADDITIVE — backward-compatible, no lockout:
 *   - adminLogin(): before its existing logic, POSTs the key to
 *     /api/admin-login to set the httpOnly cookie. Then it continues
 *     EXACTLY as before (verify via get-dashboard, populate the in-memory
 *     `adminKey` variable, save to sessionStorage). The ~20 existing admin
 *     fetches that read `adminKey` keep working unchanged — Stage 3 is what
 *     migrates them to the cookie. If the cookie call fails for any reason,
 *     login still proceeds the old way.
 *   - adminLogout(): additionally POSTs to /api/admin-logout to clear the
 *     cookie, then does everything it did before.
 *
 * The raw key still lives in sessionStorage after this stage — that is the
 * deliberate no-lockout safety net during migration. It is fully removed in
 * Stage 4, once Stage 3 has every endpoint reading the cookie.
 *
 * One file: public/cmshaveaccesstouser2026-npmevy.html  (2 edits).
 * SAFE TO RE-RUN: skipped if the file already contains TMC_PATCH40S2.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const MARKER = 'TMC_PATCH40S2';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch40s2-' + STAMP, 'public');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  adminLogin()  — establish the cookie, then proceed as before
 * ======================================================================*/
const LOGIN_FIND = [
  "function adminLogin() {",
  "  adminKey = document.getElementById('admin-key').value.trim();",
  "  if (!adminKey) { document.getElementById('login-err').textContent = 'Enter admin key'; return; }",
  "  document.getElementById('login-err').textContent = 'Verifying...';"
].join('\r\n');

const LOGIN_REPLACE = [
  "function adminLogin() {",
  "  adminKey = document.getElementById('admin-key').value.trim();",
  "  if (!adminKey) { document.getElementById('login-err').textContent = 'Enter admin key'; return; }",
  "  document.getElementById('login-err').textContent = 'Verifying...';",
  "  /* TMC_PATCH40S2: also establish the signed httpOnly admin session",
  "     cookie. This is additive — it runs before the existing verify-and-",
  "     load logic, which is unchanged. If it fails (network, old server),",
  "     login still proceeds the legacy way, so no admin is ever locked out.",
  "     Stage 3 makes endpoints read this cookie; Stage 4 drops the key. */",
  "  try {",
  "    fetch('/api/admin-login', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json' },",
  "      body: JSON.stringify({ key: adminKey })",
  "    }).catch(function () { /* non-fatal — legacy path still works */ });",
  "  } catch (e) { /* non-fatal */ }"
].join('\r\n');

/* ========================================================================
 * EDIT 2  adminLogout()  — also clear the cookie
 * ======================================================================*/
const LOGOUT_FIND = [
  "function adminLogout() {",
  "  sessionStorage.removeItem('tmc_admin_key'); /* TMC_PATCH39 */"
].join('\r\n');

const LOGOUT_REPLACE = [
  "function adminLogout() {",
  "  /* TMC_PATCH40S2: also clear the httpOnly admin session cookie on the",
  "     server. Additive and non-fatal — the rest of logout runs regardless. */",
  "  try {",
  "    fetch('/api/admin-logout', { method: 'POST' })",
  "      .catch(function () { /* non-fatal */ });",
  "  } catch (e) { /* non-fatal */ }",
  "  sessionStorage.removeItem('tmc_admin_key'); /* TMC_PATCH39 */"
].join('\r\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 40 Stage 2  wire admin login/logout to the cookie');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(FILE)) {
  fail('expected file not found: ' + FILE
    + '  (run from the project root; this is the renamed admin page)');
}

const original = fs.readFileSync(FILE, 'utf8');

if (original.indexOf(MARKER) !== -1) {
  log(FILE + ': skip (already patched)\n');
  process.exit(0);
}

const EDITS = [
  { label: 'adminLogin: establish httpOnly cookie', find: LOGIN_FIND,  replace: LOGIN_REPLACE  },
  { label: 'adminLogout: clear httpOnly cookie',    find: LOGOUT_FIND, replace: LOGOUT_REPLACE }
];

let updated = original;
for (const edit of EDITS) {
  const first = updated.indexOf(edit.find);
  if (first === -1) {
    fail('pattern NOT FOUND ["' + edit.label + '"]. '
      + 'The file may have changed. Nothing was written.');
  }
  if (updated.indexOf(edit.find, first + 1) !== -1) {
    fail('pattern found MORE THAN ONCE ["' + edit.label + '"]. '
      + 'Aborting. Nothing was written.');
  }
  updated = updated.replace(edit.find, function () { return edit.replace; });
  log('   - applied: ' + edit.label);
}

/* sanity: both new fetches must now be present exactly once */
function countOf(s, sub) { let n = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; } return n; }
if (countOf(updated, "fetch('/api/admin-login'") !== 1 ||
    countOf(updated, "fetch('/api/admin-logout'") !== 1) {
  fail('post-edit sanity check failed. Nothing was written.');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');
log('   - written + backed up');

log('\nDone. Admin page patched (2 edits).\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 40 Stage 2: admin login/logout use httpOnly cookie"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Test  see the verification notes.\n');
