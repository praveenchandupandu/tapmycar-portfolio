/* ============================================================================
 * TapMyCar  Patch 67 cookie-auth restore  (Stage 3 reapply on generate-tokens)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch67-cookie-auth-restore.js
 *
 * Patch 67 rewrote api/generate-tokens.js for fast bulk insert and, in
 * doing so, dropped the Stage 3 cookie-auth lines from Patch 40. The
 * endpoint now reads only the x-admin-key header — but after Stage 4 the
 * admin page sends an empty header value (cookie is the real auth). So
 * every Generate / Create replacements click 401s.
 *
 * Fix: add the SAME two changes Stage 3 made to the other 14 admin
 * endpoints, applied to the post-Patch-67 file:
 *
 *   1. After the existing require()s, add:
 *        const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth');
 *
 *   2. Right before  if (adminKey !== process.env.ADMIN_SECRET_KEY)  add:
 *        let adminKey -> instead of const, so it can be reassigned, plus
 *        if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY;
 *
 * Legacy x-admin-key path is left intact (no lockout). Cookie request
 * authorises through the new line. Identical pattern to Stage 3.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH67_COOKIE.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join('api', 'generate-tokens.js');
const MARKER = 'TMC_PATCH67_COOKIE';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch67-cookie-' + STAMP, 'api');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const EDITS = [
  { label: 'add resolveAdmin import',
    find:    "const { audit } = require('./_audit'); /* TMC_PATCH20_AUDIT_AND_OPS */",
    replace: "const { audit } = require('./_audit'); /* TMC_PATCH20_AUDIT_AND_OPS */\n"
           + "const { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth'); /* TMC_PATCH67_COOKIE: reapply Stage-3 cookie auth */" },
  { label: 'accept admin cookie before the legacy key compare',
    find:    "  const adminKey = req.headers['x-admin-key'];\n"
           + "  if (adminKey !== process.env.ADMIN_SECRET_KEY) {",
    replace: "  let adminKey = req.headers['x-admin-key'];\n"
           + "  if (_tmcResolveAdminCookie(req)) adminKey = process.env.ADMIN_SECRET_KEY; /* TMC_PATCH67_COOKIE: accept httpOnly admin cookie */\n"
           + "  if (adminKey !== process.env.ADMIN_SECRET_KEY) {" }
];

/* ========================================================================
 * DRIVER  (CRLF-agnostic)
 * ======================================================================*/
log('\nTapMyCar  Patch 67 cookie-auth restore');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(FILE)) {
  fail('expected file not found: ' + FILE + '  (run from the project root)');
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
    fail('pattern NOT FOUND ["' + edit.label + '"]. NOTHING was written.');
  }
  if (updated.indexOf(edit.find, first + 1) !== -1) {
    fail('pattern found MORE THAN ONCE ["' + edit.label + '"]. Aborting.');
  }
  updated = updated.replace(edit.find, function () { return edit.replace; });
  log('   - applied: ' + edit.label);
}

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');

try {
  execSync('node --check "' + FILE + '"', { stdio: 'pipe' });
  log('   - node --check: OK');
} catch (e) {
  fs.writeFileSync(FILE, original, 'utf8');
  fail('node --check FAILED  ' + FILE + ' was restored to its original.\n'
    + String(e.stderr || e.message));
}

log('\nDone. 1 file changed (2 surgical edits).\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 67 cookie-auth restore: reapply Stage-3 cookie support on generate-tokens"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Hard-refresh admin page, click Generate  should work.\n');
