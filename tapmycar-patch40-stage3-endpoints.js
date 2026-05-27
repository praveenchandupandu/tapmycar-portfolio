/* ============================================================================
 * TapMyCar  Patch 40  Stage 3  admin endpoints accept the httpOnly cookie
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch40-stage3-endpoints.js
 *
 * Makes all 15 admin-protected endpoints accept the signed httpOnly admin
 * session cookie (set by Stage 1/2) IN ADDITION TO the legacy raw key.
 *
 * DESIGN — minimal and uniform, lowest risk:
 *   Every endpoint already does, in effect:
 *       const someKey = <read key from header/query/body>;
 *       if (someKey !== process.env.ADMIN_SECRET_KEY) -> 401
 *   This patch inserts ONE line right before that check:
 *       if (resolveAdminCookie(req)) someKey = process.env.ADMIN_SECRET_KEY;
 *   i.e. "if the request carries a valid admin cookie, treat the key var as
 *   correct." The existing comparison then passes. The legacy key paths are
 *   left COMPLETELY UNTOUCHED — a request with a correct raw key still works
 *   exactly as before, so there is zero lockout risk.
 *
 *   resolveAdminCookie() is the cookie-only half of _admin-auth.js — it does
 *   NOT accept a raw key, so this patch cannot weaken anything: a request
 *   with no cookie and a wrong key still 401s.
 *
 * Backend-only. Each endpoint gets 2 edits (a require + one cookie line);
 * get-dashboard.js gets the require once + 4 cookie lines (it has 4 checks).
 *
 * Stage 4 (later) removes the legacy key paths entirely. THIS stage keeps
 * them — it is purely additive.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH40S3.
 * Two-pass: nothing is written unless every pattern in every file is found.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch40s3-' + STAMP, 'api');
const MARKER = 'TMC_PATCH40S3';

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* the require line inserted after each file's first require(...) line */
const REQ = "\nconst { resolveAdmin: _tmcResolveAdminCookie } = require('./_admin-auth'); /* TMC_PATCH40S3 */";
/* NOTE: we import resolveAdmin but use it as a COOKIE check. resolveAdmin
   also accepts a legacy key — harmless here, because the line only ever
   SETS the key var to the correct value when resolveAdmin is true, and a
   legacy key being correct would have passed the existing check anyway. */

/* one cookie line, parameterised by the key-variable name in that file */
function cookieLine(varName) {
  return "  if (_tmcResolveAdminCookie(req)) " + varName +
    " = process.env.ADMIN_SECRET_KEY; /* TMC_PATCH40S3: accept httpOnly admin cookie */";
}

/* ========================================================================
 * Per-file edits. For each: an `import` edit (anchor = that file's first
 * require line) and one or more `cookie` edits.
 *
 * IMPORTANT: the key variable must be a `let`/`var` to be reassignable.
 * Files that declare it `const` get the declaration switched to `let` as
 * part of the same edit (noted per file).
 * ======================================================================*/
const FILES = {};

/* helper to register a simple endpoint with a header/body/query key var */
function reg(file, requireAnchor, checkFind, keyVarDecl, keyVarName) {
  FILES[file] = [
    { label: 'import resolveAdmin', find: requireAnchor, replace: requireAnchor + REQ },
    { label: 'accept admin cookie',
      find: keyVarDecl + "\n" + checkFind,
      replace: keyVarDecl.replace(/^(\s*)const /, '$1let ') + "\n"
               + cookieLine(keyVarName) + "\n" + checkFind }
  ];
}

/* --- the 8 x-admin-key-header endpoints --------------------------------- */
reg('api/admin-gift-activate.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/admin-gift-revoke.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/generate-tokens.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/get-leads.js',
    "const { createClient } = require(\"@supabase/supabase-js\");",
    "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/get-orders.js',
    "const { createClient } = require(\"@supabase/supabase-js\");",
    "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/update-order-status.js',
    "const { createClient } = require(\"@supabase/supabase-js\");",
    "  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/update-settings.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

reg('api/verify-tags.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "  const adminKey = req.headers['x-admin-key'];", 'adminKey');

/* --- get-audit-log.js: key var is `admin`, declared via two lines ------- */
reg('api/get-audit-log.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "  if (admin !== process.env.ADMIN_SECRET_KEY) {",
    "  const admin = (req.headers && req.headers['x-admin-key']) || req.query.admin;",
    'admin');

/* --- get-reviews.js: `adminKey` then `isAdmin` derived. Insert cookie ---
   line before the isAdmin derivation so isAdmin becomes true. ------------ */
FILES['api/get-reviews.js'] = [
  { label: 'import resolveAdmin',
    find: "const { createClient } = require('@supabase/supabase-js');",
    replace: "const { createClient } = require('@supabase/supabase-js');" + REQ },
  { label: 'accept admin cookie',
    find:
      "  const adminKey = req.query.admin_key || req.headers['x-admin-key'];\n" +
      "  const isAdmin = adminKey === process.env.ADMIN_SECRET_KEY;",
    replace:
      "  let adminKey = req.query.admin_key || req.headers['x-admin-key'];\n" +
      cookieLine('adminKey') + "\n" +
      "  const isAdmin = adminKey === process.env.ADMIN_SECRET_KEY;" }
];

/* --- get-tag.js: key var `_adminKey`, inside an if-block ---------------- */
reg('api/get-tag.js',
    "const { createClient } = require('@supabase/supabase-js');",
    "        if (_adminKey !== process.env.ADMIN_SECRET_KEY) {",
    "        const _adminKey = req.headers['x-admin-key'] || (req.body && req.body.admin_key) || '';",
    '_adminKey');

/* --- moderate-review.js & send-broadcast.js: key is `admin_key`, but it's
   destructured via `const { ... admin_key ... } = req.body;` — cannot just
   flip to let easily without touching siblings. Instead introduce a new
   mutable alias right before the check. -------------------------------- */
FILES['api/moderate-review.js'] = [
  { label: 'import resolveAdmin',
    find: "const { createClient } = require('@supabase/supabase-js');",
    replace: "const { createClient } = require('@supabase/supabase-js');" + REQ },
  { label: 'accept admin cookie',
    find: "  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {",
    replace:
      "  let _tmcAdminKey = admin_key; /* TMC_PATCH40S3 */\n" +
      "  if (_tmcResolveAdminCookie(req)) _tmcAdminKey = process.env.ADMIN_SECRET_KEY;\n" +
      "  if (!_tmcAdminKey || _tmcAdminKey !== process.env.ADMIN_SECRET_KEY) {" }
];

FILES['api/send-broadcast.js'] = [
  { label: 'import resolveAdmin',
    find: "const { createClient } = require('@supabase/supabase-js');",
    replace: "const { createClient } = require('@supabase/supabase-js');" + REQ },
  { label: 'accept admin cookie',
    find: "  if (!admin_key || admin_key !== process.env.ADMIN_SECRET_KEY) {",
    replace:
      "  let _tmcAdminKey = admin_key; /* TMC_PATCH40S3 */\n" +
      "  if (_tmcResolveAdminCookie(req)) _tmcAdminKey = process.env.ADMIN_SECRET_KEY;\n" +
      "  if (!_tmcAdminKey || _tmcAdminKey !== process.env.ADMIN_SECRET_KEY) {" }
];

/* --- qr-knowmore.js: key var `key`, require anchor is the qrcode line --- */
reg('api/qr-knowmore.js',
    "const QRCode = require('qrcode');",
    "  if (!key || key !== process.env.ADMIN_SECRET_KEY) {",
    "  const key = req.query && req.query.key;",
    'key');

/* --- get-dashboard.js: require once + FOUR cookie lines ----------------- */
FILES['api/get-dashboard.js'] = [
  { label: 'import resolveAdmin',
    find: "const { createClient } = require('@supabase/supabase-js');",
    replace: "const { createClient } = require('@supabase/supabase-js');" + REQ },
  { label: 'cookie check 1 (admin actions)',
    find:
      "    if (action && admin_key) {\n" +
      "      if (admin_key !== process.env.ADMIN_SECRET_KEY) {",
    replace:
      "    if (action && admin_key) {\n" +
      "      if (!_tmcResolveAdminCookie(req) && admin_key !== process.env.ADMIN_SECRET_KEY) { /* TMC_PATCH40S3 */" },
  { label: 'cookie check 2 (create_test_user)',
    find:
      "    if (action === 'create_test_user') {\n" +
      "      if (admin_key !== process.env.ADMIN_SECRET_KEY) {",
    replace:
      "    if (action === 'create_test_user') {\n" +
      "      if (!_tmcResolveAdminCookie(req) && admin_key !== process.env.ADMIN_SECRET_KEY) { /* TMC_PATCH40S3 */" },
  { label: 'cookie check 3 (create_test_scan)',
    find:
      "    if (action === 'create_test_scan') {\n" +
      "      if (admin_key !== process.env.ADMIN_SECRET_KEY) {",
    replace:
      "    if (action === 'create_test_scan') {\n" +
      "      if (!_tmcResolveAdminCookie(req) && admin_key !== process.env.ADMIN_SECRET_KEY) { /* TMC_PATCH40S3 */" },
  { label: 'cookie check 4 (admin GET mode)',
    find:
      "  if (admin) {\n" +
      "    if (admin !== process.env.ADMIN_SECRET_KEY) {\n" +
      "      return res.json({ admin: false });",
    replace:
      "  if (admin || _tmcResolveAdminCookie(req)) { /* TMC_PATCH40S3 */\n" +
      "    if (!_tmcResolveAdminCookie(req) && admin !== process.env.ADMIN_SECRET_KEY) {\n" +
      "      return res.json({ admin: false });" }
];

/* ========================================================================
 * DRIVER  (two-pass: validate everything, then write everything)
 * ======================================================================*/
log('\nTapMyCar  Patch 40 Stage 3  admin endpoints accept the cookie');
log('Backups -> ' + BACKUP_DIR + '\n');

const planned = [];
let skipped = 0;

for (const file of Object.keys(FILES)) {
  if (!fs.existsSync(file)) {
    fail('expected file not found: ' + file + '  (run from the project root)');
  }
  const original = fs.readFileSync(file, 'utf8');

  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    skipped++;
    continue;
  }

  /* CRLF-agnostic: match against an LF-normalised copy, then restore the
     file's original line ending on write. */
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const edit of FILES[file]) {
    const first = updated.indexOf(edit.find);
    if (first === -1) {
      fail('pattern NOT FOUND in ' + file + '  ["' + edit.label + '"].\n'
        + 'NOTHING was written.');
    }
    if (updated.indexOf(edit.find, first + 1) !== -1) {
      fail('pattern found MORE THAN ONCE in ' + file + '  ["' + edit.label
        + '"]. Aborting. NOTHING was written.');
    }
    updated = updated.replace(edit.find, function () { return edit.replace; });
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  planned.push({ file, original, updated });
  log(file + ': ready (' + FILES[file].length + ' edits)');
}

if (planned.length === 0) {
  log('\nAll files already patched. Nothing to do.\n');
  process.exit(0);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const p of planned) {
  fs.copyFileSync(p.file, path.join(BACKUP_DIR, path.basename(p.file)));
  fs.writeFileSync(p.file, p.updated, 'utf8');
}

let checkFailed = null;
for (const p of planned) {
  try {
    execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
  } catch (e) {
    checkFailed = { file: p.file, err: String(e.stderr || e.message) };
    break;
  }
}

if (checkFailed) {
  for (const p of planned) fs.writeFileSync(p.file, p.original, 'utf8');
  fail('node --check FAILED for ' + checkFailed.file
    + '  ALL files were restored to their original content.\n'
    + checkFailed.err);
}

log('   - node --check: OK for all ' + planned.length + ' files');
log('\nDone. Files changed: ' + planned.length
  + (skipped ? ('  (skipped ' + skipped + ' already-patched)') : '') + '\n');

log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 40 Stage 3: admin endpoints accept httpOnly cookie"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Test  see the verification notes.\n');
