/* ============================================================================
 * TapMyCar  Patch 40  Stage 4  drop legacy admin key  (raw key out of browser)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch40-stage4-drop-legacy.js
 *
 * After this, only the signed httpOnly cookie authenticates an admin
 * request. The raw admin key is no longer accepted by the server, no longer
 * stored in the browser, and no longer attached to URLs.
 *
 * TWO files change.
 *
 *   1. api/_admin-auth.js
 *      resolveAdmin() returns true only for a valid signed cookie. The
 *      legacy raw-key branch is removed.
 *
 *   2. public/cmshaveaccesstouser2026-npmevy.html
 *      a) adminLogin() rewritten as a clean chain:
 *           POST /api/admin-login  (sets the cookie)  ->
 *           GET  /api/get-dashboard?admin=1  (cookie auths; returns data)
 *         The typed key lives only in a local var for the duration of the
 *         POST. After the chain starts, adminKey = '' and the input is
 *         cleared. NO sessionStorage write.
 *      b) sessionStorage.tmc_admin_key  writes removed in the success
 *         path, the idle-logout, and adminLogout.
 *      c) Auto-sign-in on page load: replaced. Instead of reading a saved
 *         key, ping /api/get-dashboard?admin=1; the browser's existing
 *         cookie (if any) authenticates, and on admin:true the panel
 *         appears straight away. Also one-time cleans up any stale
 *         tmc_admin_key from older browsers.
 *      d) p36bDownloadQr(): anchor URL drops ?key=. The cookie rides on
 *         the download automatically (same-origin).
 *      e) getAdminKey(): always returns ''. Callers still work because
 *         every admin endpoint is now cookie-authenticated; the empty
 *         legacy header/body value is just ignored.
 *
 *   The Patch 39 URL-strip fetch wrapper is left in place — with no key to
 *   strip it's a harmless no-op, and removing it adds risk for no gain.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH40S4.
 * Two-pass: nothing is written unless every pattern in both files is found.
 * Line-ending agnostic: matches against LF-normalised content, writes back
 * with each file's original endings preserved.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUTH = path.join('api', '_admin-auth.js');
const HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const MARKER = 'TMC_PATCH40S4';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch40s4-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * api/_admin-auth.js  — one edit
 * ======================================================================*/

const AUTH_EDITS = [{
  label: 'resolveAdmin: cookie-only',
  find: [
    "function resolveAdmin(req) {",
    "  /* 1) preferred: signed httpOnly cookie */",
    "  const cookieTok = readCookie(req, COOKIE_NAME);",
    "  if (cookieTok && verifyAdminSession(cookieTok)) return true;",
    "  /* 2) legacy: a correct raw admin key (constant-time compared) */",
    "  const raw = legacyAdminKey(req);",
    "  if (raw && ADMIN_KEY) {",
    "    const a = Buffer.from(String(raw));",
    "    const b = Buffer.from(String(ADMIN_KEY));",
    "    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;",
    "  }",
    "  return false;",
    "}"
  ].join('\n'),
  replace: [
    "/* TMC_PATCH40S4: cookie-only admin auth. The legacy raw-key branch has",
    "   been REMOVED — only a valid signed httpOnly cookie authenticates an",
    "   admin request now. This is what closes the original \"raw key in the",
    "   browser\" exposure: a leaked key string can no longer authenticate. */",
    "function resolveAdmin(req) {",
    "  const cookieTok = readCookie(req, COOKIE_NAME);",
    "  if (cookieTok && verifyAdminSession(cookieTok)) return true;",
    "  return false;",
    "}"
  ].join('\n')
}];

/* ========================================================================
 * public/cmshaveaccesstouser2026-npmevy.html  — six edits
 * ======================================================================*/

/* The login flow today is one continuous block:
   adminLogin opens -> Stage2's try/catch POSTs admin-login fire-and-forget
   -> fetch('/api/get-dashboard?admin='+adminKey) verifies + loads.
   We replace the WHOLE adminLogin function in ONE edit. That's safer than
   stitching pieces together — the function becomes a single chain we own,
   and we don't have to coordinate async ordering across edits. */
const HTML_LOGIN_FIND = [
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
  "  } catch (e) { /* non-fatal */ }",
  "  fetch('/api/get-dashboard?admin=' + encodeURIComponent(adminKey))",
  "    .then(r => r.json())",
  "    .then(data => {",
  "      if (data.admin) {",
  "        document.getElementById('login-overlay').style.display = 'none';",
  "        document.getElementById('admin-content').classList.remove('is-hidden');",
  "        sessionStorage.setItem('tmc_admin_key', adminKey); /* TMC_PATCH39: */",
  "        /* TMC_PATCH17_IDLE_LOGOUT: arm idle logout once admin is signed in */",
  "        if (typeof installIdleLogout === 'function') {",
  "          installIdleLogout({",
  "            minutes: 10,",
  "            warningSeconds: 60,",
  "            onLogout: function() {",
  "              try { sessionStorage.removeItem('tmc_admin_key'); } catch (e) {} /* TMC_PATCH39: */",
  "              if (typeof adminLogout === 'function') adminLogout();",
  "              else window.location.reload();",
  "            }",
  "          });",
  "        }",
  "        renderDashboard(data);",
  "        loadBatchOptions(data.tags || []);",
  "      } else {",
  "        document.getElementById('login-err').textContent = 'Invalid admin key';",
  "      }",
  "    })",
  "    .catch(() => { document.getElementById('login-err').textContent = 'Network error'; });",
  "}"
].join('\n');

const HTML_LOGIN_REPLACE = [
  "function adminLogin() {",
  "  /* TMC_PATCH40S4: cookie-only login as a single chain.",
  "        POST /api/admin-login  (sets the cookie if the key is correct)",
  "        -> GET /api/get-dashboard?admin=1  (the cookie authenticates;",
  "           server returns admin:true with the data)",
  "     The typed key lives only in _kInput for the duration of the POST,",
  "     then is cleared. adminKey = '' afterwards: every other fetch in the",
  "     page that reads adminKey sends an empty (ignored) legacy value, and",
  "     the cookie does the actual authentication. NO sessionStorage write. */",
  "  var _kInput = document.getElementById('admin-key').value.trim();",
  "  if (!_kInput) { document.getElementById('login-err').textContent = 'Enter admin key'; return; }",
  "  document.getElementById('login-err').textContent = 'Verifying...';",
  "  fetch('/api/admin-login', {",
  "    method: 'POST',",
  "    headers: { 'Content-Type': 'application/json' },",
  "    body: JSON.stringify({ key: _kInput })",
  "  }).then(function (loginR) {",
  "    _kInput = '';",
  "    adminKey = '';",
  "    document.getElementById('admin-key').value = '';",
  "    if (!loginR.ok) {",
  "      document.getElementById('login-err').textContent = 'Invalid admin key';",
  "      return null;",
  "    }",
  "    return fetch('/api/get-dashboard?admin=1').then(function (r) { return r.json(); });",
  "  }).then(function (data) {",
  "    if (!data) return;",
  "    if (data.admin) {",
  "      document.getElementById('login-overlay').style.display = 'none';",
  "      document.getElementById('admin-content').classList.remove('is-hidden');",
  "      /* TMC_PATCH17_IDLE_LOGOUT: arm idle logout once signed in */",
  "      if (typeof installIdleLogout === 'function') {",
  "        installIdleLogout({",
  "          minutes: 10,",
  "          warningSeconds: 60,",
  "          onLogout: function() {",
  "            if (typeof adminLogout === 'function') adminLogout();",
  "            else window.location.reload();",
  "          }",
  "        });",
  "      }",
  "      if (typeof renderDashboard === 'function') renderDashboard(data);",
  "      if (typeof loadBatchOptions === 'function') loadBatchOptions(data.tags || []);",
  "    } else {",
  "      document.getElementById('login-err').textContent = 'Invalid admin key';",
  "    }",
  "  }).catch(function () {",
  "    document.getElementById('login-err').textContent = 'Network error';",
  "  });",
  "}"
].join('\n');

/* The remaining edits don't overlap with the login replacement above
   because they live elsewhere in the file (auto-sign-in, adminLogout,
   p36bDownloadQr, getAdminKey). The two sessionStorage cleanup edits
   (login success / idle logout) are subsumed by the new login function,
   so we DON'T need separate edits for those — the old lines are gone. */

const HTML_AUTOLOGIN_FIND = [
  "const savedKey = sessionStorage.getItem('tmc_admin_key'); /* TMC_PATCH39: */",
  "if (savedKey) { adminKey = savedKey; document.getElementById('admin-key').value = savedKey; adminLogin(); }"
].join('\n');

const HTML_AUTOLOGIN_REPLACE = [
  "/* TMC_PATCH40S4: no more reading the key from storage. One-time cleanup",
  "   to delete any stale tmc_admin_key from older browsers. Then check for",
  "   an existing valid admin cookie by pinging the server; if good, show",
  "   the panel straight away — same UX as the old saved-key auto-login. */",
  "try { sessionStorage.removeItem('tmc_admin_key'); } catch (e) {}",
  "try { localStorage.removeItem('tmc_admin_key'); } catch (e) {}",
  "(function autoSignInFromCookie() {",
  "  fetch('/api/get-dashboard?admin=1')",
  "    .then(function (r) { return r.ok ? r.json() : null; })",
  "    .then(function (d) {",
  "      if (!d || !d.admin) return;",
  "      adminKey = '';",
  "      document.getElementById('login-overlay').style.display = 'none';",
  "      document.getElementById('admin-content').classList.remove('is-hidden');",
  "      if (typeof renderDashboard === 'function') renderDashboard(d);",
  "      if (typeof loadBatchOptions === 'function') loadBatchOptions(d.tags || []);",
  "      if (typeof installIdleLogout === 'function') {",
  "        installIdleLogout({",
  "          minutes: 10,",
  "          warningSeconds: 60,",
  "          onLogout: function () {",
  "            if (typeof adminLogout === 'function') adminLogout();",
  "            else window.location.reload();",
  "          }",
  "        });",
  "      }",
  "    }).catch(function () { /* no cookie or network error — show login as usual */ });",
  "})();"
].join('\n');

const HTML_LOGOUT_FIND =
  "  sessionStorage.removeItem('tmc_admin_key'); /* TMC_PATCH39: */";
const HTML_LOGOUT_REPLACE =
  "  /* TMC_PATCH40S4: nothing in storage to remove; the cookie was cleared by /api/admin-logout above. */";

const HTML_QR_FIND = [
  "function p36bDownloadQr() {",
  "  /* adminKey is the global var populated from localStorage.tmc_admin_key */",
  "  var k = (typeof adminKey === 'string' && adminKey) ? adminKey : '';",
  "  if (!k) {",
  "    alert('Admin key not loaded. Refresh the page and try again.');",
  "    return;",
  "  }",
  "  /* Direct browser download via anchor element. */",
  "  var a = document.createElement('a');",
  "  a.href = '/api/qr-knowmore?key=' + encodeURIComponent(k);"
].join('\n');

const HTML_QR_REPLACE = [
  "function p36bDownloadQr() {",
  "  /* TMC_PATCH40S4: no key in the URL. qr-knowmore accepts the httpOnly",
  "     admin cookie (Stage 3); the cookie rides along on the download",
  "     automatically because it's a same-origin GET. */",
  "  var a = document.createElement('a');",
  "  a.href = '/api/qr-knowmore';"
].join('\n');

const HTML_GETKEY_FIND = [
  "function getAdminKey() {",
  "  if (typeof adminKey !== 'undefined' && adminKey) return adminKey;",
  "  return sessionStorage.getItem('tmc_admin_key') || ''; /* TMC_PATCH39: */",
  "}"
].join('\n');

const HTML_GETKEY_REPLACE = [
  "function getAdminKey() {",
  "  /* TMC_PATCH40S4: legacy callers still invoke this; they all also send",
  "     the cookie, so the empty string here is harmless and ignored. */",
  "  return '';",
  "}"
].join('\n');

const HTML_EDITS = [
  { label: 'adminLogin: cookie-only single chain', find: HTML_LOGIN_FIND,     replace: HTML_LOGIN_REPLACE },
  { label: 'auto-sign-in via cookie ping',         find: HTML_AUTOLOGIN_FIND, replace: HTML_AUTOLOGIN_REPLACE },
  { label: 'adminLogout: no sessionStorage',       find: HTML_LOGOUT_FIND,    replace: HTML_LOGOUT_REPLACE },
  { label: 'p36bDownloadQr: drop ?key=',           find: HTML_QR_FIND,        replace: HTML_QR_REPLACE },
  { label: 'getAdminKey: always empty',            find: HTML_GETKEY_FIND,    replace: HTML_GETKEY_REPLACE }
];

/* ========================================================================
 * DRIVER  (two-pass, line-ending agnostic)
 * ======================================================================*/
log('\nTapMyCar  Patch 40 Stage 4  drop legacy admin key');
log('Backups -> ' + BACKUP_DIR + '\n');

const FILES = [
  { path: AUTH, edits: AUTH_EDITS },
  { path: HTML, edits: HTML_EDITS }
];

const planned = [];
let skipped = 0;

for (const F of FILES) {
  if (!fs.existsSync(F.path)) fail('expected file not found: ' + F.path);
  const original = fs.readFileSync(F.path, 'utf8');

  if (original.indexOf(MARKER) !== -1) {
    log(F.path + ': skip (already patched)');
    skipped++;
    continue;
  }

  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');

  for (const edit of F.edits) {
    const first = updated.indexOf(edit.find);
    if (first === -1) {
      fail('pattern NOT FOUND in ' + F.path + '  ["' + edit.label + '"]. '
        + 'NOTHING was written.');
    }
    if (updated.indexOf(edit.find, first + 1) !== -1) {
      fail('pattern found MORE THAN ONCE in ' + F.path + '  ["' + edit.label
        + '"]. Aborting. NOTHING was written.');
    }
    updated = updated.replace(edit.find, function () { return edit.replace; });
  }

  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  planned.push({ file: F.path, original, updated, edits: F.edits.length });
  log(F.path + ': ready (' + F.edits.length + ' edits)');
}

if (planned.length === 0) {
  log('\nAll files already patched. Nothing to do.\n');
  process.exit(0);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const p of planned) {
  const dest = path.join(BACKUP_DIR, p.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(p.file, dest);
  fs.writeFileSync(p.file, p.updated, 'utf8');
}

let checkFailed = null;
for (const p of planned) {
  try {
    if (p.file.endsWith('.js')) {
      execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
    } else if (p.file.endsWith('.html')) {
      const s = p.updated;
      const i = s.indexOf('function adminLogin()');
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p40s4-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p40s4-chk.js', { stdio: 'pipe' });
    }
  } catch (e) {
    checkFailed = { file: p.file, err: String(e.stderr || e.message) };
    break;
  }
}

if (checkFailed) {
  for (const p of planned) fs.writeFileSync(p.file, p.original, 'utf8');
  fail('syntax check FAILED for ' + checkFailed.file
    + '  ALL files were restored to their original content.\n'
    + checkFailed.err);
}

log('   - syntax check: OK for all ' + planned.length + ' files');
log('\nDone. Files changed: ' + planned.length
  + (skipped ? ('  (skipped ' + skipped + ' already-patched)') : '') + '\n');

log('PATCH 40 IS COMPLETE — the raw admin key no longer lives in the browser.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 40 Stage 4: drop legacy admin key (cookie-only)"');
log('  3. git push   (wait ~60s for Vercel)');
log('  4. Hard-refresh admin page (Ctrl+Shift+R), log in fresh, test:');
log('     - panel loads normally');
log('     - Application -> Storage: no tmc_admin_key anywhere');
log('     - Network: requests carry no key, only the cookie');
log('     - Download QR Code button works');
log('     - refresh page: auto-signs back in from the cookie\n');
log('IF SOMETHING BREAKS:  git revert HEAD && git push  rolls back in ~90s.\n');
