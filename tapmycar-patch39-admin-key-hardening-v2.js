/* ============================================================================
 * TapMyCar  Patch 39  admin key hardening  (REBUILT for post-39b filenames)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch39-admin-key-hardening-v2.js
 *
 * This is the corrected Patch 39. The original assumed the admin page was
 * still public/admin.html; Patch 39b has since renamed it. This version
 * targets the current filename AND fixes all FIVE localStorage uses of the
 * admin key (the original missed one — the getter at the bottom of the
 * file — which would have left the key half-migrated).
 *
 * THREE files, all changes safe-by-construction:
 *
 *   A. public/cmshaveaccesstouser2026-npmevy.html  (the renamed admin page)
 *      - All 5 reads/writes of tmc_admin_key move localStorage -> sessionStorage,
 *        so the key clears when the browser closes and no longer persists on
 *        disk.
 *      - A fetch wrapper moves any ?admin= / ?admin_key= query value into the
 *        x-admin-key header and strips it from the URL before the request
 *        leaves the browser (keeps the key out of server/proxy logs and the
 *        Referer header). Wrapped in try/catch — on any failure it falls
 *        through to a normal fetch, so an admin call can never be broken.
 *
 *   B. api/get-audit-log.js   - also accept the key from the x-admin-key
 *   C. api/get-dashboard.js     header (additive; legacy ?admin= still works,
 *                               so no admin lockout).
 *
 * All three ship in ONE commit so backend + frontend go live together.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH39.
 * Two-pass: nothing is written unless every pattern in every file is found.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ADMIN = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch39v2-' + STAMP;
const MARKER = 'TMC_PATCH39:';  /* trailing colon: cannot collide with TMC_PATCH39B */

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- admin.html fetch wrapper (CRLF, to match the file) ---------------- */
const WRAPPER = [
  "",
  "/* TMC_PATCH39: keep the admin key out of request URLs (and therefore out",
  "   of server logs, proxy logs and the Referer header). Moves any ?admin=",
  "   / ?admin_key= query value into the x-admin-key request header and",
  "   strips it from the URL before the request leaves the browser. On any",
  "   failure it falls through to a normal fetch, so an admin call can never",
  "   be broken — worst case the key stays in the URL as before. */",
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
 * Per-file edits  (find-strings are the EXACT current local text)
 * ======================================================================*/
const FILES = {

  'api/get-audit-log.js': [
    { label: 'accept x-admin-key header',
      find:
        "  const { admin, limit } = req.query;\n" +
        "  if (admin !== process.env.ADMIN_SECRET_KEY) {",
      replace:
        "  /* TMC_PATCH39: accept the admin key from the x-admin-key header\n" +
        "     (preferred — keeps it out of the URL and logs) or the legacy\n" +
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

  /* the renamed admin page — 6 edits: wrapper + all 5 localStorage uses */
  [ADMIN]: [
    { label: 'install URL-strip fetch wrapper',
      find:    "let adminKey = '';",
      replace: "let adminKey = '';\r\n" + WRAPPER },
    { label: 'sessionStorage: save key on login',
      find:    "        localStorage.setItem('tmc_admin_key', adminKey);",
      replace: "        sessionStorage.setItem('tmc_admin_key', adminKey); /* TMC_PATCH39: */" },
    { label: 'sessionStorage: clear key on idle logout',
      find:    "              try { localStorage.removeItem('tmc_admin_key'); } catch (e) {}",
      replace: "              try { sessionStorage.removeItem('tmc_admin_key'); } catch (e) {} /* TMC_PATCH39: */" },
    { label: 'sessionStorage: read saved key on load',
      find:    "const savedKey = localStorage.getItem('tmc_admin_key');",
      replace: "const savedKey = sessionStorage.getItem('tmc_admin_key'); /* TMC_PATCH39: */" },
    { label: 'sessionStorage: clear key on logout',
      find:    "function adminLogout() {\r\n  localStorage.removeItem('tmc_admin_key');",
      replace: "function adminLogout() {\r\n  sessionStorage.removeItem('tmc_admin_key'); /* TMC_PATCH39: */" },
    { label: 'sessionStorage: getter at end of file',
      find:    "  return localStorage.getItem('tmc_admin_key') || '';",
      replace: "  return sessionStorage.getItem('tmc_admin_key') || ''; /* TMC_PATCH39: */" }
  ]
};

/* ========================================================================
 * DRIVER  (two-pass: validate everything, then write everything)
 * ======================================================================*/
log('\nTapMyCar  Patch 39 (v2)  admin key hardening');
log('Backups -> ' + BACKUP_DIR + '\n');

const planned = [];
let skipped = 0;

for (const file of Object.keys(FILES)) {
  if (!fs.existsSync(file)) {
    fail('expected file not found: ' + file
      + '  (run from the project root; admin page must be the renamed file)');
  }
  const original = fs.readFileSync(file, 'utf8');

  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already contains ' + MARKER + ')');
    skipped++;
    continue;
  }

  let updated = original;
  for (const edit of FILES[file]) {
    const first = updated.indexOf(edit.find);
    if (first === -1) {
      fail('pattern NOT FOUND in ' + file + '  ["' + edit.label + '"].\n'
        + 'NOTHING was written. Send me the exact current text of that area.');
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
for (const p of planned) {
  const dest = path.join(BACKUP_DIR, p.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(p.file, dest);
  fs.writeFileSync(p.file, p.updated, 'utf8');
}

/* syntax-check .js files; for the admin html, check the injected wrapper */
let checkFailed = null;
for (const p of planned) {
  try {
    if (p.file.endsWith('.js')) {
      execSync('node --check "' + p.file + '"', { stdio: 'pipe' });
    } else if (p.file.endsWith('.html')) {
      const s = p.updated;
      const a = s.indexOf('/* TMC_PATCH39: keep the admin key');
      const b = s.indexOf('})();', a) + 5;
      fs.writeFileSync('/tmp/tmc-p39v2-chk.js', s.slice(a, b));
      execSync('node --check /tmp/tmc-p39v2-chk.js', { stdio: 'pipe' });
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

log('NEXT STEPS (you already committed 39b; this is the second commit):');
log('  1. git add -A');
log('  2. git commit -m "Patch 39: admin key hardening (sessionStorage + header)"');
log('  3. git push   (39b + 39 deploy together)');
log('  4. Test  see the verification notes.\n');
