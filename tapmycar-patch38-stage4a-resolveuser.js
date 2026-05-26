/* ============================================================================
 * TapMyCar  Patch 38  Stage 4a  signed-session adoption (9 endpoints)
 * ----------------------------------------------------------------------------
 * Run from the project root:   node tapmycar-patch38-stage4a-resolveuser.js
 *
 * WHAT THIS DOES
 *   1. api/_auth.js
 *        - extractToken() now reads ONLY the Authorization: Bearer header
 *          and the explicit `user_id` field. It no longer reads a generic
 *          `token` field (overloaded in this codebase — e.g. create-checkout
 *          puts a TAG token there, which would mis-resolve the caller).
 *        - Adds recordTokenType(supabase, userId, viaLegacy): a best-effort
 *          stat write for the Stage 4c migration counter.
 *
 *   2. Nine sensitive endpoints now identify the caller with resolveUser():
 *        get-referral, generate-referral-code, claim-reward,
 *        create-subscription, cancel-subscription-preview, get-billing,
 *        delete-account, cancel-subscription, create-checkout
 *      Each: resolveUser() accepts a NEW signed token OR a legacy UUID, so
 *      no logged-in user is locked out. The resolved id replaces whatever
 *      user_id the request body/query claimed (this is the IDOR fix —
 *      callers can no longer act as an arbitrary UUID).
 *
 *   3. Creates patch38s4-migration.sql  (two columns on `users`).
 *
 * NOT IN THIS PATCH: get-dashboard.js (Stage 4b) and the admin counter UI
 * (Stage 4c).
 *
 * BEFORE DEPLOYING: run patch38s4-migration.sql in the Supabase SQL editor.
 * (If you forget, nothing breaks — recordTokenType fails silently — but the
 * counter won't have data until the columns exist.)
 *
 * SAFE TO RE-RUN: each file is skipped if it already contains TMC_PATCH38S4.
 * NOTHING is written unless every pattern in every file is found first.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch38s4a-' + STAMP, 'api');
const MARKER = 'TMC_PATCH38S4';

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- the resolveUser block injected into endpoints --------------------- */
const BLOCK = [
  "  /* TMC_PATCH38S4: identify the caller from a signed session token or a",
  "     legacy UUID. resolveUser() accepts both, so no logged-in user is",
  "     locked out; the resolved id replaces any user_id the request claimed",
  "     (IDOR fix). viaLegacy records which token type, for the counter. */",
  "  const _tmcAuth = resolveUser(req);",
  "  if (!_tmcAuth) return res.status(401).json({ error: 'Authentication required' });",
  "  const user_id = _tmcAuth.userId;",
  "  await recordTokenType(supabase, user_id, _tmcAuth.viaLegacy);"
].join('\n');

const IMPORT_FIND =
  "const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);";
const IMPORT_REPLACE = IMPORT_FIND +
  "\nconst { resolveUser, recordTokenType } = require('./_auth'); /* TMC_PATCH38S4 */";

/* ========================================================================
 * Per-file edit definitions. Each endpoint: the import insert + the
 * user_id-extraction replacement.
 * ======================================================================*/
const FILES = {

  'api/_auth.js': [
    { label: 'extractToken doc comment',
      find:
        "/* Pull the raw token from a request: Authorization: Bearer xxx,\n" +
        "   or body.token / body.user_id, or query.token / query.user_id. */",
      replace:
        "/* TMC_PATCH38S4: pull the caller's auth identifier from a request.\n" +
        "   - signed token   -> Authorization: Bearer <token> (set by the\n" +
        "     Stage 3 fetch wrapper in app.js)\n" +
        "   - legacy raw UUID -> the explicit `user_id` field (body or query)\n" +
        "   We deliberately do NOT read a generic `token` field: in this\n" +
        "   codebase `token` is overloaded (tag tokens, etc.), so using it for\n" +
        "   auth would mis-resolve the caller. */" },
    { label: 'extractToken body/query lookup',
      find:
        "  if (req.body && (req.body.token || req.body.user_id)) {\n" +
        "    return String(req.body.token || req.body.user_id).trim();\n" +
        "  }\n" +
        "  if (req.query && (req.query.token || req.query.user_id)) {\n" +
        "    return String(req.query.token || req.query.user_id).trim();\n" +
        "  }",
      replace:
        "  if (req.body && req.body.user_id) return String(req.body.user_id).trim();\n" +
        "  if (req.query && req.query.user_id) return String(req.query.user_id).trim();" },
    { label: 'recordTokenType helper + exports',
      find:
        "module.exports = { signSession, verifySession, resolveUser, extractToken, isUuid };",
      replace:
        "/* TMC_PATCH38S4: record which token type a user's request used so the\n" +
        "   admin panel can show migration progress (legacy -> signed). Takes\n" +
        "   the caller's own supabase client; never throws, never blocks the\n" +
        "   request on a stats failure. Needs users.last_token_type /\n" +
        "   last_token_at (see patch38s4-migration.sql). */\n" +
        "async function recordTokenType(supabase, userId, viaLegacy) {\n" +
        "  try {\n" +
        "    if (!supabase || !userId) return;\n" +
        "    await supabase.from('users').update({\n" +
        "      last_token_type: viaLegacy ? 'legacy' : 'signed',\n" +
        "      last_token_at: new Date().toISOString()\n" +
        "    }).eq('id', userId);\n" +
        "  } catch (e) {\n" +
        "    /* non-fatal — a stats write must never break a real request */\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "module.exports = { signSession, verifySession, resolveUser, extractToken, isUuid, recordTokenType };" }
  ],

  'api/get-referral.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id } = req.query;\n" +
        "  if (!user_id) return res.status(400).json({ error: \"user_id required\" });",
      replace: BLOCK }
  ],

  'api/generate-referral-code.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id } = req.body;\n" +
        "  if (!user_id) return res.status(400).json({ error: \"user_id required\" });",
      replace: BLOCK }
  ],

  'api/claim-reward.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id, choice } = req.body;\n" +
        "  if (!user_id || !choice) return res.status(400).json({ error: \"user_id and choice required\" });",
      replace: BLOCK + "\n\n" +
        "  const { choice } = req.body;\n" +
        "  if (!choice) return res.status(400).json({ error: \"choice required\" });" }
  ],

  'api/create-subscription.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id, plan } = req.body;\n" +
        "  if (!user_id || !plan) return res.status(400).json({ error: \"user_id and plan required\" });",
      replace: BLOCK + "\n\n" +
        "  const { plan } = req.body;\n" +
        "  if (!plan) return res.status(400).json({ error: \"plan required\" });" }
  ],

  'api/cancel-subscription-preview.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const user_id = (req.query && req.query.user_id) || (req.body && req.body.user_id);\n" +
        "  if (!user_id) return res.status(400).json({ error: 'user_id required' });",
      replace: BLOCK }
  ],

  'api/get-billing.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const user_id = req.query.user_id;\n" +
        "  if (!user_id) return res.status(400).json({ error: 'user_id required' });",
      replace: BLOCK }
  ],

  'api/cancel-subscription.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id } = req.body;\n" +
        "  if (!user_id) return res.status(400).json({ error: \"user_id required\" });",
      replace: BLOCK }
  ],

  'api/delete-account.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id, confirm } = req.body;\n" +
        "\n" +
        "  if (!user_id) return res.status(400).json({ error: \"user_id required\" });\n" +
        "  if (confirm !== \"DELETE\") {",
      replace: BLOCK + "\n\n" +
        "  const { confirm } = req.body;\n" +
        "  if (confirm !== \"DELETE\") {" }
  ],

  'api/create-checkout.js': [
    { label: 'import', find: IMPORT_FIND, replace: IMPORT_REPLACE },
    { label: 'resolveUser', find:
        "  const { user_id, flow, plan, prepay, referral_discount } = req.body;\n" +
        "\n" +
        "  if (!user_id) return res.status(400).json({ error: 'user_id required' });\n" +
        "  if (!flow) return res.status(400).json({ error: \"flow required: 'etag_free', 'activate', or 'direct'\" });",
      replace: BLOCK + "\n\n" +
        "  const { flow, plan, prepay, referral_discount } = req.body;\n" +
        "  if (!flow) return res.status(400).json({ error: \"flow required: 'etag_free', 'activate', or 'direct'\" });" }
  ]
};

/* ========================================================================
 * SQL migration file
 * ======================================================================*/
const SQL_PATH = 'patch38s4-migration.sql';
const SQL_TEXT =
  "-- TapMyCar  Patch 38 Stage 4  token migration tracking\n" +
  "-- Adds two columns to `users` so the admin panel (Stage 4c) can show how\n" +
  "-- many sessions are still on the legacy UUID vs the new signed token.\n" +
  "-- Safe to run more than once.\n" +
  "\n" +
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_token_type text;\n" +
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_token_at  timestamptz;\n";

/* ========================================================================
 * DRIVER  (two-pass: validate everything, THEN write everything)
 * ======================================================================*/
log('\nTapMyCar  Patch 38 Stage 4a  resolveUser adoption');
log('Backups -> ' + BACKUP_DIR + '\n');

const planned = [];   /* { file, original, updated } */
let skipped = 0;

for (const file of Object.keys(FILES)) {
  if (!fs.existsSync(file)) {
    fail('expected file not found: ' + file
      + '  (run from the project root containing api/)');
  }
  const original = fs.readFileSync(file, 'utf8');

  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    skipped++;
    continue;
  }

  let updated = original;
  for (const edit of FILES[file]) {
    const first = updated.indexOf(edit.find);
    if (first === -1) {
      fail('pattern NOT FOUND in ' + file + '  ["' + edit.label + '"].\n'
        + 'The file may have changed. NOTHING was written.');
    }
    if (updated.indexOf(edit.find, first + 1) !== -1) {
      fail('pattern found MORE THAN ONCE in ' + file + '  ["' + edit.label
        + '"]. Aborting. NOTHING was written.');
    }
    updated = updated.replace(edit.find, function () { return edit.replace; });
  }
  planned.push({ file, original, updated });
  log(file + ': ready (' + FILES[file].length + ' edits)');
}

if (planned.length === 0) {
  log('\nAll files already patched. Nothing to do.\n');
  /* still (re)write the SQL file if missing, for convenience */
  if (!fs.existsSync(SQL_PATH)) {
    fs.writeFileSync(SQL_PATH, SQL_TEXT, 'utf8');
    log('Wrote ' + SQL_PATH + ' (was missing).\n');
  }
  process.exit(0);
}

/* ---- all patterns validated -> back up, write, syntax-check ------------ */
fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const p of planned) {
  fs.copyFileSync(p.file, path.join(BACKUP_DIR, path.basename(p.file)));
  fs.writeFileSync(p.file, p.updated, 'utf8');   /* UTF-8, no BOM added */
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
  /* roll every file back to its original content */
  for (const p of planned) fs.writeFileSync(p.file, p.original, 'utf8');
  fail('node --check FAILED for ' + checkFailed.file
    + '  ALL files were restored to their original content.\n'
    + checkFailed.err);
}

log('   - node --check: OK for all ' + planned.length + ' files');

/* ---- SQL migration file ------------------------------------------------ */
fs.writeFileSync(SQL_PATH, SQL_TEXT, 'utf8');
log('   - wrote ' + SQL_PATH);

log('\nDone. Files changed: ' + planned.length
  + (skipped ? ('  (skipped ' + skipped + ' already-patched)') : '') + '\n');

log('NEXT STEPS:');
log('  1. Run patch38s4-migration.sql in the Supabase SQL editor FIRST.');
log('  2. git add -A');
log('  3. git commit -m "Patch 38 Stage 4a: 9 endpoints adopt resolveUser"');
log('  4. git push   (wait ~60s for Vercel)');
log('  5. Test in fresh incognito  see the verification notes.\n');
