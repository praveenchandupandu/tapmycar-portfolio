/* ============================================================================
 * TapMyCar  Patch 38  Stage 4b  get-dashboard.js adopts resolveUser
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch38-stage4b-get-dashboard.js
 *
 * get-dashboard.js mixes admin-key paths with user paths in one file. This
 * patch makes ONLY the two user paths identify the caller with resolveUser():
 *
 *   1. GET user mode  (the non-admin dashboard data load)
 *   2. POST regular profile update  (the non-admin "save settings" path)
 *
 * The admin-key paths (GET ?admin=KEY, and the POST update_user / suspend /
 * reactivate / test-data actions) are LEFT UNTOUCHED — they authenticate
 * with ADMIN_SECRET_KEY and, for admin actions, user_id is the *target*
 * user the admin is editing, not the caller.
 *
 * Backward-compatible: resolveUser() accepts a signed token OR a legacy
 * UUID, so no logged-in user is locked out. The resolved id replaces any
 * user_id the request claimed (IDOR fix). Depends on Stage 4a (_auth.js
 * already exports resolveUser + recordTokenType).
 *
 * SAFE TO RE-RUN: skipped if the file already contains TMC_PATCH38S4B.
 * Nothing is written unless all four patterns are found first.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join('api', 'get-dashboard.js');
const MARKER = 'TMC_PATCH38S4B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch38s4b-' + STAMP, 'api');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- the four edits ---------------------------------------------------- */
const EDITS = [

  { label: 'import resolveUser/recordTokenType',
    find:
      "const supabase = createClient(\n" +
      "  process.env.SUPABASE_URL,\n" +
      "  process.env.SUPABASE_SERVICE_KEY\n" +
      ");",
    replace:
      "const supabase = createClient(\n" +
      "  process.env.SUPABASE_URL,\n" +
      "  process.env.SUPABASE_SERVICE_KEY\n" +
      ");\n" +
      "const { resolveUser, recordTokenType } = require('./_auth'); /* TMC_PATCH38S4B */" },

  { label: 'GET query destructure (drop user_id — resolved below)',
    find:  "  const { user_id, admin } = req.query;",
    replace:
      "  const { admin } = req.query; /* TMC_PATCH38S4B: user_id resolved in user mode below */" },

  { label: 'GET user mode — resolveUser',
    find:  "  if (!user_id) return res.status(400).json({ error: 'user_id required' });",
    replace:
      "  /* TMC_PATCH38S4B: user mode — identify the caller from a signed token\n" +
      "     or a legacy UUID. resolveUser() accepts both (no lockout); the\n" +
      "     resolved id replaces any user_id the query claimed (IDOR fix). */\n" +
      "  const _tmcAuth = resolveUser(req);\n" +
      "  if (!_tmcAuth) return res.status(401).json({ error: 'Authentication required' });\n" +
      "  const user_id = _tmcAuth.userId;\n" +
      "  await recordTokenType(supabase, user_id, _tmcAuth.viaLegacy);" },

  { label: 'POST regular profile update — resolveUser',
    find:
      "    // Regular user profile update (non-admin)\n" +
      "    if (user_id && name) {\n" +
      "      const updates = { name };",
    replace:
      "    // Regular user profile update (non-admin)\n" +
      "    /* TMC_PATCH38S4B: resolve the caller (signed token or legacy UUID)\n" +
      "       and act on the caller's own id, not a body-supplied user_id\n" +
      "       (IDOR fix). The inner `user_id` shadows the outer body value\n" +
      "       within this block only. */\n" +
      "    const _tmcAuthP = resolveUser(req);\n" +
      "    if (_tmcAuthP && name) {\n" +
      "      const user_id = _tmcAuthP.userId;\n" +
      "      await recordTokenType(supabase, user_id, _tmcAuthP.viaLegacy);\n" +
      "      const updates = { name };" }
];

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 38 Stage 4b  get-dashboard.js resolveUser');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(FILE)) {
  fail('expected file not found: ' + FILE
    + '  (run from the project root containing api/)');
}

const original = fs.readFileSync(FILE, 'utf8');

if (original.indexOf(MARKER) !== -1) {
  log(FILE + ': skip (already patched)\n');
  process.exit(0);
}

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

/* back up, write, syntax-check */
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');

try {
  execSync('node --check "' + FILE + '"', { stdio: 'pipe' });
  log('   - node --check: OK');
} catch (e) {
  fs.writeFileSync(FILE, original, 'utf8');   /* roll back */
  fail('node --check FAILED — ' + FILE + ' was restored to its original.\n'
    + String(e.stderr || e.message));
}

log('\nDone. get-dashboard.js patched (4 edits).\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 38 Stage 4b: get-dashboard.js adopts resolveUser"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Test in fresh incognito  see the verification notes.\n');
