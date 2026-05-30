/* ============================================================================
 * TapMyCar  Patch 45b-fix2  remove race-condition lines from pricing.html
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45b-fix2.js
 *
 * Surgical fix for the "sometimes the discount banner shows, sometimes it
 * doesn't" bug on pricing.html. The pre-existing loadReferralDiscount()
 * function was racing with Patch 45b-fix's checkbox handler:
 *
 *   - Patch 45b-fix sets the banner state based on the checkbox (default off)
 *   - loadReferralDiscount() sets the banner visible whenever referral_credits
 *     >= $3 (unconditionally, on every page load)
 *
 * Whichever runs second wins, hence the random-looking behavior.
 *
 * Fix: comment out the two lines in loadReferralDiscount() that touch the
 * discount-banner DOM and the __refDiscount global. Patch 45b-fix now has
 * sole ownership of both. The rest of loadReferralDiscount (the
 * reward-banner for 'choice' rewards) stays intact  unrelated path.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH45B_FIX2.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45B_FIX2';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45b-fix2-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const PR = path.join('public', 'pricing.html');

const FIND = [
  "    if (data.referral_credits >= 3) {",
  "      window.__refDiscount = parseFloat(data.referral_credits);",
  "      document.getElementById('discount-banner').style.display = 'block';",
  "    }"
].join('\n');

const REPLACE = [
  "    /* TMC_PATCH45B_FIX2: this block used to unconditionally show the",
  "       discount-banner and set window.__refDiscount on every page load,",
  "       racing with Patch 45b-fix's checkbox handler. The checkbox now",
  "       owns both bits of state, so this block is intentionally disabled. */",
  "    /* if (data.referral_credits >= 3) {",
  "         window.__refDiscount = parseFloat(data.referral_credits);",
  "         document.getElementById('discount-banner').style.display = 'block';",
  "       } */"
].join('\n');

log('\nTapMyCar  Patch 45b-fix2  remove race-condition lines\n');

if (!fs.existsSync(PR)) fail('expected file not found: ' + PR);
const original = fs.readFileSync(PR, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(PR + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const i = updated.indexOf(FIND);
if (i === -1) fail('pattern NOT FOUND in ' + PR + '. Nothing was written.');
if (updated.indexOf(FIND, i + 1) !== -1) fail('pattern NOT UNIQUE');
updated = updated.replace(FIND, () => REPLACE);

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(PR, path.join(BACKUP_DIR, PR));
fs.writeFileSync(PR, updated, 'utf8');

/* validate the loadReferralDiscount block still parses */
const s = fs.readFileSync(PR, 'utf8');
const at = s.indexOf('function loadReferralDiscount');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p45b-fix2-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p45b-fix2-chk.js', { stdio: 'pipe' });
    log(PR + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(PR, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 45b-fix2: remove pricing.html race condition"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Hard-refresh /pricing.html several times in a row. Banner state');
log('     should now be CONSISTENT every time (discount banner hidden by');
log('     default; appears only when checkbox is ticked).\n');
