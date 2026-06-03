/* ============================================================================
 * TapMyCar  Patch 51a hotfix  fix get-referral.js (Referrals card stuck Loading)
 * ----------------------------------------------------------------------------
 * Run: node tapmycar-patch51a-hotfix.js
 *
 * Patch 51a's auto-edit to api/get-referral.js was wrong. My regex matched the
 * FIRST .select() in the file (which selects from the users table) and appended
 * "credit_kind" to it. But credit_kind is a column on the referrals table, not
 * users. The query started failing with "column users.credit_kind does not
 * exist", get-referral returned non-success, and the settings.html Referrals
 * card has been stuck on "Loading..." ever since.
 *
 * Fix: remove credit_kind from the users select, and remove the stale marker
 * comment Patch 51a added. The actual renewal-only credit filter logic lives
 * correctly in create-checkout.js  this file didn't need any change.
 *
 * SAFE TO RE-RUN: idempotent on the broken state.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

const PATH = 'api/get-referral.js';
const BAD  = '.select("referral_code, referral_count, referral_credits, referral_reward_pending, credit_kind")';
const GOOD = '.select("referral_code, referral_count, referral_credits, referral_reward_pending")';
const STALE_COMMENT = '/* TMC_PATCH51A: credit_kind read into rows for future use */\n';

const raw = fs.readFileSync(PATH, 'utf8');
if (raw.indexOf(BAD) === -1 && raw.indexOf('TMC_PATCH51A: credit_kind') === -1) {
  console.log(PATH + ': already clean, nothing to do.');
  process.exit(0);
}

const wasCRLF = raw.indexOf('\r\n') !== -1;
let text = raw.replace(/\r\n/g, '\n');

if (text.indexOf(BAD) !== -1) {
  if (text.split(BAD).length - 1 !== 1) {
    console.error('ERROR: bad-select pattern not unique. Aborting.');
    process.exit(1);
  }
  text = text.replace(BAD, GOOD);
  console.log('  removed credit_kind from users select');
}
if (text.indexOf(STALE_COMMENT) !== -1) {
  text = text.replace(STALE_COMMENT, '');
  console.log('  removed stale marker comment');
}

if (wasCRLF) text = text.replace(/\n/g, '\r\n');

const backup = PATH + '.before-hotfix';
fs.writeFileSync(backup, raw, 'utf8');
fs.writeFileSync(PATH, text, 'utf8');

try {
  execSync('node --check "' + PATH + '"', { stdio: 'pipe' });
  console.log(PATH + ': patched, node --check OK');
} catch (e) {
  fs.writeFileSync(PATH, raw, 'utf8');
  console.error('node --check FAILED  file restored.');
  console.error(String(e.stderr || e.message));
  process.exit(1);
}

console.log('\nBackup written to:', backup);
console.log('\nNEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Fix get-referral: remove bad credit_kind column"');
console.log('  git push');
console.log('\nAfter Vercel redeploys (~60s), hard-refresh settings.html.');
console.log('Referrals card should populate properly: code, link, stats, status line.');
