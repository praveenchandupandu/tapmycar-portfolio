/* ============================================================================
 * TapMyCar  Patch 40  Stage 4 hotfix  adminKey placeholder
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch40-stage4-hotfix.js
 *
 * Fixes a Stage 4 oversight. Stage 4 set the in-memory `adminKey` variable
 * to '' (empty string), with the reasoning that the server ignores it and
 * the cookie does the real auth. That holds for SERVER-side checks, but
 * the admin page has a couple of CLIENT-side guards that read adminKey
 * directly:
 *
 *     if (!adminKey) { showToast('Sign in first'); return; }
 *
 * With adminKey = '', those guards trip and the call aborts BEFORE any
 * fetch — which is the "Unauthorized" toast you see on Generate, Test User,
 * Test Scan, etc.
 *
 * The fix is one character. Set adminKey = '_' (a placeholder) instead of
 * ''. Client-side  if (!adminKey)  checks now pass, because '_' is truthy.
 * The server still rejects '_' as a key (it's not your real admin key) —
 * but the cookie is what actually authenticates, so the server-side check
 * sees the cookie and authorizes. Nothing sensitive is exposed; '_' is not
 * a credential.
 *
 * Three sites change in public/cmshaveaccesstouser2026-npmevy.html:
 *   line 1968:  let adminKey = ''               ->  let adminKey = '_'
 *   line 2220:  adminKey = ''                   ->  adminKey = '_'
 *   line 2264:  adminKey = ''                   ->  adminKey = '_'
 *
 * Line 2208 (a code comment mentioning  adminKey = ''  ) is intentionally
 * left untouched — it is not code.
 *
 * SAFE TO RE-RUN: skipped if already patched.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const MARKER = 'TMC_PATCH40S4_HOTFIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch40s4-hotfix-' + STAMP, 'public');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* Each find string is uniquely anchored by surrounding context so we
   never touch the comment on line 2208. */
const EDITS = [
  { label: 'declaration line 1968',
    find:    "let adminKey = '';",
    replace: "let adminKey = '_'; /* TMC_PATCH40S4_HOTFIX: placeholder so client-side `if (!adminKey)` guards pass; server still ignores it, cookie auths */" },
  { label: 'adminLogin chain (line ~2220)',
    find:    "    _kInput = '';\n    adminKey = '';",
    replace: "    _kInput = '';\n    adminKey = '_'; /* TMC_PATCH40S4_HOTFIX */" },
  { label: 'auto-sign-in success (line ~2264)',
    find:    "      if (!d || !d.admin) return;\n      adminKey = '';",
    replace: "      if (!d || !d.admin) return;\n      adminKey = '_'; /* TMC_PATCH40S4_HOTFIX */" }
];

/* ========================================================================
 * DRIVER  (CRLF-agnostic: normalise to LF for matching, restore on write)
 * ======================================================================*/
log('\nTapMyCar  Patch 40 Stage 4 hotfix  adminKey placeholder');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(FILE)) {
  fail('expected file not found: ' + FILE
    + '  (run this from the project root)');
}

const original = fs.readFileSync(FILE, 'utf8');

if (original.indexOf(MARKER) !== -1) {
  log(FILE + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

for (const edit of EDITS) {
  const first = updated.indexOf(edit.find);
  if (first === -1) {
    fail('pattern NOT FOUND ["' + edit.label + '"]. '
      + 'NOTHING was written.');
  }
  if (updated.indexOf(edit.find, first + 1) !== -1) {
    fail('pattern found MORE THAN ONCE ["' + edit.label + '"]. '
      + 'Aborting. NOTHING was written.');
  }
  updated = updated.replace(edit.find, function () { return edit.replace; });
  log('   - applied: ' + edit.label);
}

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

/* sanity: exactly three "adminKey = '_'" should now exist
   (one declaration + two assignments). The comment is unchanged. */
function countOf(s, sub) { let n = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; } return n; }
if (countOf(updated, "adminKey = '_'") !== 3) {
  fail('post-edit sanity check failed (expected 3 "adminKey = \'_\'" occurrences).'
    + ' NOTHING was written.');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');

/* validate the inline <script> still parses */
try {
  const i = updated.indexOf('function adminLogin()');
  const a = updated.lastIndexOf('<script>', i) + 8;
  const b = updated.indexOf('</script>', i);
  fs.writeFileSync('/tmp/p40s4-hotfix-chk.js', updated.slice(a, b));
  execSync('node --check /tmp/p40s4-hotfix-chk.js', { stdio: 'pipe' });
  log('   - syntax check: OK');
} catch (e) {
  fs.writeFileSync(FILE, original, 'utf8');
  fail('syntax check FAILED — file restored to its original content.\n'
    + String(e.stderr || e.message));
}

log('\nDone. 1 file changed (3 surgical edits).\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 40 Stage 4 hotfix: adminKey placeholder so client guards pass"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Hard-refresh admin page, log in, try Generate batch  should work.\n');
