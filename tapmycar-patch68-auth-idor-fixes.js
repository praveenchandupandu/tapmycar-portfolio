/* tapmycar-patch68-auth-idor-fixes.js
 *
 * Closes one authentication bypass and two IDOR (insecure direct object
 * reference) holes by making three endpoints derive the user from the
 * signed session token instead of trusting a raw user_id sent by the browser.
 *
 *   1) api/confirm-phone-verification.js
 *      The "already verified -> skip the SMS check" shortcut now ALSO
 *      requires a signed session token that matches the account. Without a
 *      matching token, a fresh SMS code is always required. This stops anyone
 *      who merely knows an account's UUID from minting an activation session.
 *
 *   2) api/reactivate-etag.js
 *      Reactivates the LOGGED-IN user's own eTag (identity from token), not
 *      whatever user_id was posted.
 *
 *   3) api/save-push-subscription.js
 *      Registers a push subscription only for the logged-in user (identity
 *      from token), so you cannot subscribe someone else's account.
 *
 * Safe + idempotent:
 *   - Timestamped backup of every file it touches.
 *   - Function-based replacements (no $ interpolation surprises).
 *   - \r?\n tolerant matching (works on mixed CRLF/LF).
 *   - Each replacement MUST match exactly once or the script aborts and
 *     restores nothing was written (verify-before-write).
 *   - Re-running it is a no-op: files already carrying the TMC_PATCH68
 *     marker are skipped.
 *   - node --check is run on every edited file; a syntax error aborts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = path.join(ROOT, 'backup-patch68-' + STAMP);

const MARKER = 'TMC_PATCH68';

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s, { encoding: 'utf8' }); }

function backup(relPath) {
  const src = path.join(ROOT, relPath);
  const dest = path.join(BACKUP_DIR, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/* Replace `find` (a RegExp) exactly once. Aborts if it matches 0 or >1 times.
 * `replacement` is passed straight to String.replace, so use a function or a
 * plain string (NOT one containing $ tokens). */
function safeReplace(content, find, replacement, label) {
  const matches = content.match(new RegExp(find.source, find.flags.replace('g', '') + 'g'));
  const count = matches ? matches.length : 0;
  if (count !== 1) {
    throw new Error('  [' + label + '] expected exactly 1 match, found ' + count +
      ' — file is not in the expected state, aborting WITHOUT changes.');
  }
  return content.replace(find, replacement);
}

function nodeCheck(relPath) {
  execSync('node --check "' + path.join(ROOT, relPath) + '"', { stdio: 'pipe' });
}

/* ---- the three edits ------------------------------------------------- */

const EDITS = {
  'api/confirm-phone-verification.js': function (src) {
    // a) add the resolveUser require after the rate-limit require
    src = safeReplace(
      src,
      /const \{ rateLimit, getClientIp \} = require\('\.\/_rate-limit'\);/,
      function () {
        return "const { rateLimit, getClientIp } = require('./_rate-limit');\n" +
               "/* TMC_PATCH68 */ const { resolveUser } = require('./_auth');";
      },
      'confirm-phone-verification: add resolveUser require'
    );

    // b) gate the no-SMS shortcut behind a matching signed token
    src = safeReplace(
      src,
      /let _alreadyVerifiedShortcut = false;\r?\n\s*if \(user\.phone_verified\) \{/,
      function () {
        return '/* TMC_PATCH68: the no-Twilio shortcut for already-verified users is\n' +
               '   only safe when the caller proves they ARE that user with a valid\n' +
               '   signed session token. Without a matching token we ALWAYS require a\n' +
               '   fresh SMS code (which only the real phone owner can receive). This\n' +
               '   closes the bypass where knowing a user_id alone minted a session. */\n' +
               '  const _p68authed = resolveUser(req);\n' +
               '  const _p68tokenMatches = !!(_p68authed && String(_p68authed.userId) === String(user_id));\n' +
               '  let _alreadyVerifiedShortcut = false;\n' +
               '  if (user.phone_verified && _p68tokenMatches) {';
      },
      'confirm-phone-verification: gate shortcut behind matching token'
    );
    return src;
  },

  'api/reactivate-etag.js': function (src) {
    // a) add resolveUser require after the createClient block
    src = safeReplace(
      src,
      /const supabase = createClient\(\r?\n\s*process\.env\.SUPABASE_URL,\r?\n\s*process\.env\.SUPABASE_SERVICE_KEY\r?\n\);/,
      function (m) {
        return m + "\n/* TMC_PATCH68 */ const { resolveUser } = require('./_auth');";
      },
      'reactivate-etag: add resolveUser require'
    );

    // b) take user_id from the token, not the body
    src = safeReplace(
      src,
      /const \{ user_id \} = req\.body;\r?\n\s*if \(!user_id\) return res\.status\(400\)\.json\(\{ error: 'user_id required' \}\);/,
      function () {
        return '/* TMC_PATCH68: identity comes from the signed session token, not the body. */\n' +
               '  const _p68authed = resolveUser(req);\n' +
               "  if (!_p68authed) return res.status(401).json({ error: 'Sign in required' });\n" +
               '  const user_id = _p68authed.userId;';
      },
      'reactivate-etag: derive user_id from token'
    );
    return src;
  },

  'api/save-push-subscription.js': function (src) {
    // a) add resolveUser require after the createClient line
    src = safeReplace(
      src,
      /const supabase = createClient\(process\.env\.SUPABASE_URL, process\.env\.SUPABASE_SERVICE_KEY\);/,
      function (m) {
        return m + '\n/* TMC_PATCH68 */ const { resolveUser } = require("./_auth");';
      },
      'save-push-subscription: add resolveUser require'
    );

    // b) take user_id from the token; keep the rest of the body
    src = safeReplace(
      src,
      /const \{ user_id, endpoint, p256dh, auth \} = req\.body \|\| \{\};\r?\n\s*if \(!user_id \|\| !endpoint \|\| !p256dh \|\| !auth\) \{\r?\n\s*return res\.status\(400\)\.json\(\{ error: "Missing fields" \}\);\r?\n\s*\}/,
      function () {
        return '/* TMC_PATCH68: identity from signed session token, not the body. */\n' +
               '  const _p68authed = resolveUser(req);\n' +
               '  if (!_p68authed) return res.status(401).json({ error: "Sign in required" });\n' +
               '  const user_id = _p68authed.userId;\n' +
               '  const { endpoint, p256dh, auth } = req.body || {};\n' +
               '  if (!endpoint || !p256dh || !auth) {\n' +
               '    return res.status(400).json({ error: "Missing fields" });\n' +
               '  }';
      },
      'save-push-subscription: derive user_id from token'
    );
    return src;
  }
};

/* ---- run -------------------------------------------------------------- */

console.log('Patch 68 — auth bypass + IDOR fixes');
console.log('Backup folder: ' + path.basename(BACKUP_DIR) + '\n');

let changed = 0;
let skipped = 0;

for (const relPath of Object.keys(EDITS)) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error('Missing file: ' + relPath + ' — are you in the tapmycar folder?');
  }

  const original = read(abs);
  if (original.indexOf(MARKER) !== -1) {
    console.log('SKIP  ' + relPath + ' (already patched)');
    skipped++;
    continue;
  }

  // Build the edited version in memory first (aborts here if state is wrong).
  const edited = EDITS[relPath](original);

  // Only now do we touch disk: back up, write, then syntax-check.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  backup(relPath);
  write(abs, edited);
  try {
    nodeCheck(relPath);
  } catch (e) {
    // restore on syntax failure
    write(abs, original);
    throw new Error('node --check FAILED on ' + relPath + ' — change reverted.\n' +
      (e.stderr ? e.stderr.toString() : e.message));
  }

  console.log('OK    ' + relPath);
  changed++;
}

console.log('\nDone. ' + changed + ' file(s) changed, ' + skipped + ' skipped.');
if (changed > 0) {
  console.log('Backups saved in: ' + path.basename(BACKUP_DIR));
}
