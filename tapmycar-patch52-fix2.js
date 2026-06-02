/* ============================================================================
 * TapMyCar  Patch 52-fix2  capture email in the probe call
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch52-fix2.js
 *
 * Patch 52 captured email via a second /api/get-dashboard call that runs
 * just before delete. The PROBE call earlier in the flow already had the
 * email in its response  we just weren't reading it. If the second call
 * has any hiccup, the email field on the post-delete newsletter screen
 * shows up empty. This patch captures email/name from the probe response
 * directly, so by the time the user reaches the signup screen, the email
 * was captured the moment the probe succeeded.
 *
 * The second redundant capture call stays as a safety net  no removal.
 *
 * One file modified: public/settings.html.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH52_FIX2.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH52_FIX2';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch52-fix2-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SETTINGS = path.join('public', 'settings.html');

/* ========================================================================
 * EDIT  inside the probe call in submitPreDelete(), capture email/name as
 * a side effect of the probe success. Same effect even when the offer is
 * skipped (already used).
 * ======================================================================*/

const FIND = [
  "    if (probe.ok) {",
  "      var probeData = await probe.json();",
  "      var alreadyShown = probeData && probeData.user && probeData.user.retention_offer_shown_at;"
].join('\n');

const REPLACE = [
  "    if (probe.ok) {",
  "      var probeData = await probe.json();",
  "      /* TMC_PATCH52_FIX2: while we're already here, capture email/name",
  "         for the post-delete newsletter screen. This is the EARLIEST point",
  "         where we know the user object is fresh from DB. */",
  "      try {",
  "        window.__tmcDelEmail = (probeData && probeData.user && probeData.user.email) || window.__tmcDelEmail || '';",
  "        window.__tmcDelName  = (probeData && probeData.user && probeData.user.name)  || window.__tmcDelName  || '';",
  "      } catch (e) {}",
  "      var alreadyShown = probeData && probeData.user && probeData.user.retention_offer_shown_at;"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 52-fix2  capture email in the probe call\n');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(SETTINGS)) fail('settings.html not found');
const original = fs.readFileSync(SETTINGS, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SETTINGS + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const i = updated.indexOf(FIND);
if (i === -1) fail('pattern NOT FOUND');
if (updated.indexOf(FIND, i + 1) !== -1) fail('pattern NOT UNIQUE');
updated = updated.replace(FIND, () => REPLACE);

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(SETTINGS, path.join(BACKUP_DIR, SETTINGS));
fs.writeFileSync(SETTINGS, updated, 'utf8');

const s = fs.readFileSync(SETTINGS, 'utf8');
const at = s.indexOf('TMC_PATCH52_FIX2: while we');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p52-fix2-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p52-fix2-chk.js', { stdio: 'pipe' });
    log(SETTINGS + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(SETTINGS, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 52-fix2: capture email in probe call"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Test the delete flow again. Email field should be pre-filled this time.');
log('\nBug 2 (TapMyCar Alert popup): NOT addressed in this patch. Answer the');
log('diagnostic questions in chat first so I know whether to disable the test');
log('announcement, fix the seen-tracking, or change the always-shown logic.\n');
