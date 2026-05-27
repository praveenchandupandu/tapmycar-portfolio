/* ============================================================================
 * TapMyCar  Patch 39  admin key hardening
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch39-admin-key-hardening.js
 *
 * Two hardening changes for the admin key (ADMIN_SECRET_KEY). This is a
 * SEPARATE issue from Patch 38 — it pre-dated it.
 *
 *   A. Out of localStorage -> sessionStorage  (public/admin.html)
 *      The admin key no longer persists on disk between browser sessions.
 *      It clears when the tab/browser closes; you re-enter it next visit.
 *
 *   B. Out of request URLs -> x-admin-key header  (all 3 files)
 *      - Backend: get-dashboard.js and get-audit-log.js now ALSO accept the
 *        key from the x-admin-key header (get-reviews.js already did).
 *        Additive — the legacy ?admin= query param still works too.
 *      - admin.html: a small fetch wrapper moves any ?admin= / ?admin_key=
 *        value into the x-admin-key header and strips it from the URL
 *        BEFORE the request leaves the browser. So the key stops appearing
 *        in Vercel access logs, proxy logs and the Referer header.
 *
 * SAFE BY CONSTRUCTION:
 *   - Backend changes are additive (header OR query) — no admin lockout.
 *   - The fetch wrapper is wrapped in try/catch; if anything fails it falls
 *     through to a normal fetch, so worst case the key stays in the URL as
 *     before — an admin call can never be broken by this patch.
 *   - All 3 files ship in one commit, so backend + frontend go live together.
 *
 * NOT done here (recommended, zero code): rotate ADMIN_SECRET_KEY in Vercel
 * to a long random value — the old key has been travelling in URLs/logs.
 *
 * SAFE TO RE-RUN: each file is skipped if it already contains TMC_PATCH39.
 * Nothing is written unless every pattern in every file is found first.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch39-' + STAMP;
const MARKER = 'TMC_PATCH39';

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- the admin.html fetch wrapper (CRLF, to match admin.html) ---------- */
const WRAPPER = [
  "",
  "/* TMC_PATCH39: keep the admin key out of request URLs (and therefore out",
  "   of server logs, proxy logs and the Referer header). This wrapper moves",
  "   any ?admin= / ?admin_key= query value into the x-admin-key request",
  "   header and strips it from the URL before the request leaves the",
  "   browser. If anything goes wrong it falls through to a normal fetch, so",
  "   an admin call can never be broken by this  worst case the key stays in",
  "   the URL exactly as it did before this patch. */",
  "(function () {",
  "  if (window.__tmcAdminKeyWrapInstalled) return;",
  "  var origFetch = window.fetch ? window.fetch.bind(window) : null;",
  "  if (!origFetch) return;",
  "  window.__tmcAdminKeyWrapInstalled = true;",
  "  window.fetch = function (input, init) {",
  "    try {",
  "      var url = (typeof input === 'string') ? input",
  "              : (input && input.url) ? input.url : '';",
  "      if (url && url.indexOf('/api/') !== -1) {",
  "        var u = new URL(url, window.location.origin);",
  "        if (u.origin === window.location.origin) {",
  "          var key = u.searchParams.get('admin') || u.searchParams.get('admin_key');",
  "          if (key) {",
  "            u.searchParams.delete('admin');",
  "            u.searchParams.delete('admin_key');",
  "            var h = new Headers((init && init.headers) || {});",
  "            if (!h.has('x-admin-key')) h.set('x-admin-key', key);",
  "            var newInit = Object.assign({}, init || {});",
  "            newInit.headers = h;",
  "            return origFetch(u.pathname + u.search, newInit);",
  "          }",
  "        }",
  "      }",
  "    } catch (e) {",
  "      /* fall through to a normal fetch */",
  "    }",
  "    return origFetch(input, init);",
  "  };",
  "})();"
].join('\r\n');

/* ========================================================================
 * Per-file edits
 * ======================================================================*/
const FILES = {

  'api/get-audit-log.js': [
    { label: 'accept x-admin-key header',
      find:
        "  const { admin, limit } = req.query;\n" +
        "  if (admin !== process.env.ADMIN_SECRET_KEY) {",
      replace:
        "  /* TMC_PATCH39: accept the admin key from the x-admin-key header\n" +
        "     (preferred  keeps it out of the URL and logs) or the legacy\n" +
        "     ?admin= query param. */\n" +
        "  const { limit } = req.query;\n" +
        "  const admin = (req.headers && req.headers['x-admin-key']) || req.query.admin;\n" +
        "  if (admin !== process.env.ADMIN_SECRET_KEY) {" }
  ],

  'api/get-dashboard.js': [
    { label: 'accept x-admin-key header',
      find:
        "  const { admin } = req.query; /* TMC_PATCH38S4B: user_id resolved in user mode below */",
      replace:
        "  /* TMC_PATCH39: accept the admin key from the x-admin-key header\n" +
        "     (keeps it out of the URL and logs) or the legacy ?admin= query. */\n" +
        "  const admin = (req.headers && req.headers['x-admin-key']) || req.query.admin; /* TMC_PATCH38S4B: user_id resolved in user mode below */" }
  ],

  'public/admin.html': [
    { label: 'install admin-key URL-strip fetch wrapper',
      find:    "let adminKey = '';",
      replace: "let adminKey = '';\r\n" + WRAPPER },
    { label: 'sessionStorage: save key on login',
      find:    "        localStorage.setItem('tmc_admin_key', adminKey);",
      replace: "        sessionStorage.setItem('tmc_admin_key', adminKey); /* TMC_PATCH39 */" },
    { label: 'sessionStorage: clear key on idle logout',
      find:    "              try { localStorage.removeItem('tmc_admin_key'); } catch (e) {}",
      replace: "              try { sessionStorage.removeItem('tmc_admin_key'); } catch (e) {} /* TMC_PATCH39 */" },
    { label: 'sessionStorage: read saved key on load',
      find:    "const savedKey = localStorage.getItem('tmc_admin_key');",
      replace: "const savedKey = sessionStorage.getItem('tmc_admin_key'); /* TMC_PATCH39 */" },
    { label: 'sessionStorage: clear key on logout',
      find:    "function adminLogout() {\r\n  localStorage.removeItem('tmc_admin_key');",
      replace: "function adminLogout() {\r\n  sessionStorage.removeItem('tmc_admin_key'); /* TMC_PATCH39 */" }
  ]
};

/* ========================================================================
 * DRIVER  (two-pass: validate everything, then write everything)
 * ======================================================================*/
log('\nTapMyCar  Patch 39  admin key hardening');
log('Backups -> ' + BACKUP_DIR + '\n');

const planned = [];
let skipped = 0;

for (const file of Object.keys(FILES)) {
  if (!fs.existsSync(file)) {
    fail('expected file not found: ' + file
      + '  (run from the project root)');
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
  process.exit(0);
}

/* back up + write */
fs.mkdirSync(BACKUP_DIR, { recursive: true });
for (const p of planned) {
  const dest = path.join(BACKUP_DIR, p.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(p.file, dest);
  fs.writeFileSync(p.file, p.updated, 'utf8');
}

/* syntax-check the .js files; for admin.html, check the injected wrapper */
let checkFailed = null;
for (const p of planned) {
  try {
    if (p.file.endsWith('.js')) {
      execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
    } else if (p.file.endsWith('admin.html')) {
      const s = p.updated;
      const a = s.indexOf('/* TMC_PATCH39: keep the admin key');
      const b = s.indexOf('})();', a) + 5;
      fs.writeFileSync('/tmp/tmc-p39-chk.js', s.slice(a, b));
      execSync('node --check /tmp/tmc-p39-chk.js', { stdio: 'pipe' });
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

log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 39: admin key hardening (sessionStorage + header)"');
log('  3. git push   (wait ~60s for Vercel  all 3 files deploy together)');
log('  4. Test in fresh incognito  see the verification notes.');
log('');
log('RECOMMENDED (zero code): after this deploys, rotate ADMIN_SECRET_KEY in');
log('Vercel to a long random value and re-log-in with it. The old key has');
log('been travelling in URLs/logs.\n');
