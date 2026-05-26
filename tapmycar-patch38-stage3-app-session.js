/* ============================================================================
 * TapMyCar  Patch 38  Stage 3  app.js signed-session storage + send
 * ----------------------------------------------------------------------------
 * Run from the project root:   node tapmycar-patch38-stage3-app-session.js
 *
 * WHAT THIS DOES (all changes are in the public/ folder  the folder Vercel
 * actually serves, per vercel.json "outputDirectory": "public"):
 *
 *   1. public/app.js
 *        - saveSession() gains an optional 4th arg, sessionToken, and stores
 *          it under localStorage key 'tmc_session_token'.
 *        - getSession() now also returns sessionToken.
 *        - A small fetch() wrapper is installed that attaches
 *          "Authorization: Bearer <signed token>" to same-origin /api/
 *          requests  ONLY when a signed token is stored.
 *
 *   2. public/signin.html, public/register.html, public/contact.html
 *        - The saveSession(...) calls now pass data.session_token.
 *
 *   3. public/dashboard.html
 *        - The idle-logout handler also clears 'tmc_session_token'.
 *
 * BACKWARD-COMPATIBLE BY DESIGN  no logged-in user is locked out:
 *   - 'tmc_token' (the legacy raw UUID) is still stored and still sent in
 *     every request body/query exactly as before. Nothing is removed.
 *   - The signed token rides in a NEW header. Endpoints that don't read it
 *     (everything, until Stage 4) simply ignore it.
 *   - A user with an old session (no signed token) has nothing attached and
 *     behaves 100% as before.
 *
 * SAFE TO RE-RUN: every edit is marker-guarded and skipped if already applied.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/* --- timestamped backup folder (project convention) ---------------------- */
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch38s3-' + STAMP, 'public');

function log(msg) { console.log(msg); }
function fail(msg) { console.error('\n  ERROR: ' + msg + '\n'); process.exit(1); }

/* --- function-based safeReplace with idempotency + safety guards --------- */
function safeReplace(content, label, find, replace, doneMarker) {
  if (doneMarker && content.indexOf(doneMarker) !== -1) {
    log('   - skip (already applied): ' + label);
    return content;
  }
  const first = content.indexOf(find);
  if (first === -1) {
    throw new Error('pattern NOT FOUND for "' + label + '". '
      + 'The file may have changed since this patch was written. '
      + 'No file was modified.');
  }
  if (content.indexOf(find, first + 1) !== -1) {
    throw new Error('pattern found MORE THAN ONCE for "' + label + '". '
      + 'Aborting to avoid an ambiguous edit. No file was modified.');
  }
  log('   - applied: ' + label);
  /* function form so nothing in `replace` is treated as a $-pattern */
  return content.replace(find, function () { return replace; });
}

function backup(relPath) {
  const dest = path.join(BACKUP_DIR, path.basename(relPath));
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(relPath, dest);
}

/* ========================================================================
 * EDIT 1  public/app.js
 * ======================================================================*/
const APP = path.join('public', 'app.js');

const APP_FIND = [
  "function saveSession(token, phone, name) {",
  "  localStorage.setItem('tmc_token', token);",
  "  localStorage.setItem('tmc_phone', phone);",
  "  localStorage.setItem('tmc_name', name);",
  "}",
  "",
  "function getSession() {",
  "  return {",
  "    token: localStorage.getItem('tmc_token'),",
  "    phone: localStorage.getItem('tmc_phone'),",
  "    name: localStorage.getItem('tmc_name'),",
  "  };",
  "}",
  ""
].join('\r\n');

const APP_REPLACE = [
  "/* TMC_PATCH38S3_SESSION  Patch 38 Stage 3  signed-session storage + send.",
  "   Backward-compatible by design:",
  "     - tmc_token (legacy raw UUID) is still stored exactly as before.",
  "     - tmc_session_token (the new HMAC-signed token from verify-otp) is",
  "       stored alongside it.",
  "   Either one alone lets the backend identify the user, so a user who was",
  "   logged in before this deploy (legacy token only) is never locked out.",
  "   saveSession() now takes an optional 4th arg: sessionToken. */",
  "function saveSession(token, phone, name, sessionToken) {",
  "  localStorage.setItem('tmc_token', token);",
  "  localStorage.setItem('tmc_phone', phone);",
  "  localStorage.setItem('tmc_name', name);",
  "  if (sessionToken) {",
  "    /* fresh login on a server that issued a signed token */",
  "    localStorage.setItem('tmc_session_token', sessionToken);",
  "  } else if (sessionToken === null || sessionToken === '') {",
  "    /* server explicitly returned no signed token  clear any stale one */",
  "    localStorage.removeItem('tmc_session_token');",
  "  }",
  "  /* sessionToken === undefined (legacy 3-arg caller): leave token as-is */",
  "}",
  "",
  "function getSession() {",
  "  return {",
  "    token: localStorage.getItem('tmc_token'),",
  "    phone: localStorage.getItem('tmc_phone'),",
  "    name: localStorage.getItem('tmc_name'),",
  "    sessionToken: localStorage.getItem('tmc_session_token'),",
  "  };",
  "}",
  "",
  "/* TMC_PATCH38S3_FETCH_AUTH  attach the signed session token to same-origin",
  "   /api/ requests as an 'Authorization: Bearer <token>' header.",
  "   STRICTLY ADDITIVE: it only ADDS a header. It never removes user_id or",
  "   token from any request body or query string. Endpoints that do not yet",
  "   read the header simply ignore it; once Stage 4 endpoints adopt",
  "   resolveUser() they read this header first and fall back to the legacy",
  "   user_id UUID  so no user is ever locked out. If no signed token is",
  "   stored (legacy session) nothing is attached and requests are unchanged. */",
  "(function () {",
  "  if (window.__tmcFetchAuthInstalled) return;   /* idempotent at runtime */",
  "  var origFetch = window.fetch ? window.fetch.bind(window) : null;",
  "  if (!origFetch) return;",
  "  window.__tmcFetchAuthInstalled = true;",
  "  window.fetch = function (input, init) {",
  "    try {",
  "      var url = (typeof input === 'string') ? input",
  "              : (input && input.url) ? input.url : '';",
  "      if (url) {",
  "        var u = new URL(url, window.location.origin);",
  "        var isSameOriginApi = (u.origin === window.location.origin) &&",
  "                              (u.pathname.indexOf('/api/') === 0);",
  "        if (isSameOriginApi) {",
  "          var tok = null;",
  "          try { tok = localStorage.getItem('tmc_session_token'); } catch (e) {}",
  "          if (tok) {",
  "            var h = new Headers((init && init.headers) || {});",
  "            if (!h.has('Authorization')) {",
  "              h.set('Authorization', 'Bearer ' + tok);",
  "            }",
  "            var newInit = Object.assign({}, init || {});",
  "            newInit.headers = h;",
  "            return origFetch(input, newInit);",
  "          }",
  "        }",
  "      }",
  "    } catch (e) {",
  "      /* never let auth-wrapping break a request  fall through */",
  "    }",
  "    return origFetch(input, init);",
  "  };",
  "})();",
  ""
].join('\r\n');

/* ========================================================================
 * EDITS 2a/2b/2c  saveSession call sites
 * ======================================================================*/
const SIGNIN = path.join('public', 'signin.html');
const SIGNIN_FIND =
  "saveSession(data.token, data.phone || '', data.name || '');";
const SIGNIN_REPLACE =
  "saveSession(data.token, data.phone || '', data.name || '', data.session_token); /* TMC_PATCH38S3 */";

const REGISTER = path.join('public', 'register.html');
const REGISTER_FIND =
  "saveSession(data.token, data.phone || phone, data.name || name);";
const REGISTER_REPLACE =
  "saveSession(data.token, data.phone || phone, data.name || name, data.session_token); /* TMC_PATCH38S3 */";

const CONTACT = path.join('public', 'contact.html');
const CONTACT_FIND =
  "saveSession(data.token,data.phone||registrationData.phone,data.name||registrationData.name);";
const CONTACT_REPLACE =
  "saveSession(data.token,data.phone||registrationData.phone,data.name||registrationData.name,data.session_token); /* TMC_PATCH38S3 */";

/* ========================================================================
 * EDIT 3  public/dashboard.html  idle-logout also clears the signed token
 * ======================================================================*/
const DASHBOARD = path.join('public', 'dashboard.html');
const DASH_FIND = [
  "        localStorage.removeItem('tmc_token');",
  "        localStorage.removeItem('tmc_phone');",
  "        localStorage.removeItem('tmc_name');"
].join('\r\n');
const DASH_REPLACE = DASH_FIND + "\r\n" +
  "        localStorage.removeItem('tmc_session_token'); /* TMC_PATCH38S3 */";

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 38 Stage 3  signed-session storage + send');
log('Backups -> ' + BACKUP_DIR + '\n');

const jobs = [
  { file: APP,       label: 'app.js  saveSession/getSession + fetch wrapper',
    find: APP_FIND, replace: APP_REPLACE, marker: 'TMC_PATCH38S3_SESSION' },
  { file: SIGNIN,    label: 'signin.html  pass session_token',
    find: SIGNIN_FIND, replace: SIGNIN_REPLACE, marker: 'TMC_PATCH38S3' },
  { file: REGISTER,  label: 'register.html  pass session_token',
    find: REGISTER_FIND, replace: REGISTER_REPLACE, marker: 'TMC_PATCH38S3' },
  { file: CONTACT,   label: 'contact.html  pass session_token',
    find: CONTACT_FIND, replace: CONTACT_REPLACE, marker: 'TMC_PATCH38S3' },
  { file: DASHBOARD, label: 'dashboard.html  clear session_token on idle logout',
    find: DASH_FIND, replace: DASH_REPLACE, marker: 'tmc_session_token' }
];

let changedCount = 0;

for (const job of jobs) {
  if (!fs.existsSync(job.file)) {
    fail('expected file not found: ' + job.file
      + '  (run this script from the project root that contains public/)');
  }
  log(job.file + ':');
  const original = fs.readFileSync(job.file, 'utf8');
  let updated;
  try {
    updated = safeReplace(original, job.label, job.find, job.replace, job.marker);
  } catch (e) {
    fail(e.message);
  }
  if (updated === original) continue;   /* skipped / nothing to do */

  backup(job.file);                     /* back up the real file first */
  fs.writeFileSync(job.file, updated, 'utf8');   /* UTF-8, no BOM */
  changedCount++;

  /* validate JS files with node --check; restore on failure */
  if (job.file.endsWith('.js')) {
    try {
      execSync('node --check "' + job.file + '"', { stdio: 'pipe' });
      log('   - node --check: OK');
    } catch (e) {
      fs.writeFileSync(job.file, original, 'utf8');   /* roll back */
      fail('node --check FAILED for ' + job.file
        + '  the file was restored to its original content.\n'
        + String(e.stderr || e.message));
    }
  }
}

log('\nDone. Files changed this run: ' + changedCount + '\n');

if (changedCount > 0) {
  log('Next steps:');
  log('  1. git add public/app.js public/signin.html public/register.html \\');
  log('            public/contact.html public/dashboard.html');
  log('  2. git commit -m "Patch 38 Stage 3: signed-session storage + send (app.js)"');
  log('  3. git push   (wait ~60s for Vercel)');
  log('  4. Test in a fresh incognito window  see the verification notes.\n');
  log('NOTE: do NOT copy these files to the project root  vercel.json sets');
  log('      outputDirectory:"public", so only public/ is served. The root');
  log('      copies are stale and unused.\n');
} else {
  log('All edits were already present  nothing to commit.\n');
}
