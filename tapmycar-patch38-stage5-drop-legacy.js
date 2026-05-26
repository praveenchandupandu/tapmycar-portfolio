/* ============================================================================
 * TapMyCar  Patch 38  Stage 5  drop the legacy UUID fallback
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch38-stage5-drop-legacy.js
 *
 * Final stage. Removes the legacy raw-UUID branch from resolveUser() in
 * api/_auth.js. After this, every sensitive endpoint requires a valid
 * SIGNED session token — a raw user_id UUID can no longer identify (or
 * impersonate) anyone. This is what actually closes the original IDOR hole.
 *
 *   Before:  signed token  -> ok
 *            raw UUID      -> ok   (accepted — the IDOR weakness)
 *   After:   signed token  -> ok
 *            raw UUID      -> 401  (rejected)
 *
 * ── DEPLOY GATE ─────────────────────────────────────────────────────────
 * Any logged-in session WITHOUT a signed token will be 401'd after this
 * deploys and must sign in again. Before pushing, the admin "Session
 * migration" card should read Legacy: 0, and every browser/device you use
 * should already hold a signed token. A lockout here is fully recoverable
 * (just sign in again), but cleaner to avoid.
 * ────────────────────────────────────────────────────────────────────────
 *
 * One edit to api/_auth.js. SAFE TO RE-RUN: skipped if already patched.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FILE = path.join('api', '_auth.js');
const MARKER = 'TMC_PATCH38S5';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch38s5-' + STAMP, 'api');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const FIND = [
  "/* BACKWARD-COMPATIBLE resolver. Returns { userId, viaLegacy } or null.",
  "   - signed token  -> { userId, viaLegacy:false }",
  "   - legacy UUID   -> { userId, viaLegacy:true }   (still accepted)",
  "   Stage 5 (much later) will drop the legacy branch once all live",
  "   sessions have cycled to signed tokens. */",
  "function resolveUser(req) {",
  "  const raw = extractToken(req);",
  "  if (!raw) return null;",
  "  const verified = verifySession(raw);",
  "  if (verified) return { userId: verified.userId, viaLegacy: false };",
  "  if (isUuid(raw)) return { userId: raw, viaLegacy: true };",
  "  return null;",
  "}"
].join('\n');

const REPLACE = [
  "/* TMC_PATCH38S5: signed-token-only resolver. Returns { userId, viaLegacy }",
  "   or null. The legacy raw-UUID fallback has been REMOVED — a caller must",
  "   now present a valid signed session token (Authorization: Bearer ...).",
  "   This is what closes the original IDOR hole: a raw user_id can no longer",
  "   impersonate anyone. viaLegacy is always false now; it is kept only so",
  "   existing callers (recordTokenType) keep working unchanged. */",
  "function resolveUser(req) {",
  "  const raw = extractToken(req);",
  "  if (!raw) return null;",
  "  const verified = verifySession(raw);",
  "  if (verified) return { userId: verified.userId, viaLegacy: false };",
  "  return null;",
  "}"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 38 Stage 5  drop the legacy UUID fallback');
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

const first = original.indexOf(FIND);
if (first === -1) {
  fail('resolveUser() does not match the expected text. The file may have '
    + 'changed. Nothing was written.');
}
if (original.indexOf(FIND, first + 1) !== -1) {
  fail('pattern found MORE THAN ONCE. Aborting. Nothing was written.');
}

const updated = original.replace(FIND, function () { return REPLACE; });

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(FILE, path.join(BACKUP_DIR, path.basename(FILE)));
fs.writeFileSync(FILE, updated, 'utf8');

try {
  execSync('node --check "' + FILE + '"', { stdio: 'pipe' });
  log('   - applied: resolveUser legacy branch removed');
  log('   - node --check: OK');
} catch (e) {
  fs.writeFileSync(FILE, original, 'utf8');   /* roll back */
  fail('node --check FAILED — ' + FILE + ' was restored to its original.\n'
    + String(e.stderr || e.message));
}

log('\nDone. Patch 38 is now complete — the IDOR fix is fully closed.\n');
log('BEFORE PUSHING: confirm the admin migration card shows Legacy: 0 and');
log('that every browser you use is signed in with a signed token. Any');
log('session without one will be logged out and must sign in again.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 38 Stage 5: drop legacy UUID fallback (IDOR closed)"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Test in fresh incognito  see the verification notes.\n');
