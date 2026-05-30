/* ============================================================================
 * TapMyCar  Patch 45a-fix  referral card UI redesign
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45a-fix-ui.js
 *
 * Cleaner referral card UI, replacing the four-box grid (which looked dated)
 * with an integrated layout:
 *   - Header: code on the left + Share button on the right
 *   - Short URL row with copy
 *   - A single horizontal "progress" strip with the four numbers in one row,
 *     separated by thin dividers (not boxed in)
 *   - A status line beneath that adapts to the user's current state:
 *       0 signups        -> "Share your code to start earning credits"
 *       signed up only   -> "Waiting on first plan purchase  $0 confirmed"
 *       confirmed paid   -> "$X.XX available  $Y.YY pending (14-day hold)"
 *
 * No DB changes. No backend changes. Just the HTML inside settings.html.
 *
 * Run patch45a-backfill.sql in Supabase IF you have past referrals to fill
 * in (signups before Patch 45a deployed). The UI redesign in this file is
 * independent of the backfill.
 *
 * SAFE TO RE-RUN: skipped if settings.html already contains TMC_PATCH45A_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45A_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45a-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SETTINGS = path.join('public', 'settings.html');

/* =====================================================================
 * EDIT 1  replace the inner card layout (post-Patch-45a)
 * ===================================================================*/

const CARD_FIND = [
  "    <!-- TMC_PATCH45A: four-number stats grid -->",
  "    <div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px\">",
  "      <div style=\"background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#111\" id=\"ref-signups\">0</div>",
  "        <div style=\"font-size:10px;color:#6B7280;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Friends signed up</div>",
  "      </div>",
  "      <div style=\"background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#111\" id=\"ref-confirmed\">0</div>",
  "        <div style=\"font-size:10px;color:#6B7280;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Bought a plan</div>",
  "      </div>",
  "      <div style=\"background:#DCFCE7;border:1px solid #BBF7D0;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#16A34A\" id=\"ref-available\">$0</div>",
  "        <div style=\"font-size:10px;color:#15803D;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Available</div>",
  "      </div>",
  "      <div style=\"background:#FFF3EC;border:1px solid #FED7AA;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#FF6B00\" id=\"ref-pending\">$0</div>",
  "        <div style=\"font-size:10px;color:#C2410C;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Pending (14d hold)</div>",
  "      </div>",
  "    </div>",
  "    <div style=\"background:#FFF3EC;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:11px;color:#FF6B00;font-weight:600\" id=\"ref-next\">Loading...</div>"
].join('\n');

const CARD_REPLACE = [
  "    <!-- TMC_PATCH45A_FIX: integrated progress strip, no nested boxes -->",
  "    <div style=\"margin-top:18px;padding:14px 4px 0;border-top:1px solid #F3F4F6;display:flex;align-items:stretch\">",
  "      <div style=\"flex:1;text-align:center\">",
  "        <div style=\"font-size:22px;font-weight:800;color:#111;line-height:1\" id=\"ref-signups\">0</div>",
  "        <div style=\"font-size:10px;color:#9CA3AF;margin-top:6px;font-weight:600;letter-spacing:0.03em\">SIGNED UP</div>",
  "      </div>",
  "      <div style=\"width:1px;background:#F3F4F6;margin:2px 0\"></div>",
  "      <div style=\"flex:1;text-align:center\">",
  "        <div style=\"font-size:22px;font-weight:800;color:#111;line-height:1\" id=\"ref-confirmed\">0</div>",
  "        <div style=\"font-size:10px;color:#9CA3AF;margin-top:6px;font-weight:600;letter-spacing:0.03em\">PAID</div>",
  "      </div>",
  "      <div style=\"width:1px;background:#F3F4F6;margin:2px 0\"></div>",
  "      <div style=\"flex:1;text-align:center\">",
  "        <div style=\"font-size:22px;font-weight:800;color:#16A34A;line-height:1\" id=\"ref-available\">$0</div>",
  "        <div style=\"font-size:10px;color:#9CA3AF;margin-top:6px;font-weight:600;letter-spacing:0.03em\">AVAILABLE</div>",
  "      </div>",
  "      <div style=\"width:1px;background:#F3F4F6;margin:2px 0\"></div>",
  "      <div style=\"flex:1;text-align:center\">",
  "        <div style=\"font-size:22px;font-weight:800;color:#FF6B00;line-height:1\" id=\"ref-pending\">$0</div>",
  "        <div style=\"font-size:10px;color:#9CA3AF;margin-top:6px;font-weight:600;letter-spacing:0.03em\">PENDING</div>",
  "      </div>",
  "    </div>",
  "    <div id=\"ref-next\" style=\"margin-top:14px;font-size:12px;color:#6B7280;line-height:1.5\">Loading...</div>"
].join('\n');

/* =====================================================================
 * EDIT 2  smarter status line in loadReferrals
 * ===================================================================*/

const DISP_FIND = [
  "    if (data.referral_reward_pending === 'choice') { document.getElementById('ref-reward-box').style.display = 'block'; }",
  "    const count = data.referral_count || 0;",
  "    document.getElementById('ref-next').textContent = count === 0 ? 'Refer 1 friend who buys a plan - get $3 off!' : count === 1 ? 'Refer 1 more friend - Free Standard or $4.99 coupon!' : 'Keep referring - earn more rewards!';"
].join('\n');

const DISP_REPLACE = [
  "    if (data.referral_reward_pending === 'choice') { document.getElementById('ref-reward-box').style.display = 'block'; }",
  "    /* TMC_PATCH45A_FIX: status line adapts to actual state. */",
  "    var nextEl = document.getElementById('ref-next');",
  "    if (signups === 0 && confirmed === 0) {",
  "      nextEl.textContent = 'Share your code  earn $3 credit when a friend buys a plan.';",
  "    } else if (confirmed === 0) {",
  "      nextEl.textContent = signups + ' friend' + (signups === 1 ? '' : 's') + ' signed up. Credits unlock when they buy a plan.';",
  "    } else if (pending > 0 && avail === 0) {",
  "      nextEl.textContent = '$' + parseFloat(pending).toFixed(2) + ' will unlock after the 14-day refund window.';",
  "    } else if (pending > 0 && avail > 0) {",
  "      nextEl.textContent = '$' + parseFloat(avail).toFixed(2) + ' ready to use. $' + parseFloat(pending).toFixed(2) + ' unlocks soon.';",
  "    } else {",
  "      nextEl.textContent = '$' + parseFloat(avail).toFixed(2) + ' available. Use it on your next purchase.';",
  "    }"
].join('\n');

/* =====================================================================
 * DRIVER
 * ===================================================================*/

log('\nTapMyCar  Patch 45a-fix  referral card UI redesign');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

if (!fs.existsSync(SETTINGS)) fail('expected file not found: ' + SETTINGS);

const original = fs.readFileSync(SETTINGS, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SETTINGS + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const edits = [
  { label: 'card layout: progress strip',  find: CARD_FIND, replace: CARD_REPLACE },
  { label: 'loadReferrals: smart status',  find: DISP_FIND, replace: DISP_REPLACE }
];
for (const e of edits) {
  const i = updated.indexOf(e.find);
  if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']. Nothing written.');
  if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
  updated = updated.replace(e.find, () => e.replace);
}
if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
backupAndWrite(SETTINGS, original, updated);

/* syntax-check the script block */
const i = updated.indexOf('loadReferrals');
const a = updated.lastIndexOf('<script>', i) + 8;
const b = updated.indexOf('</script>', i);
fs.writeFileSync('/tmp/p45a-fix-chk.js', updated.slice(a, b));
try {
  execSync('node --check /tmp/p45a-fix-chk.js', { stdio: 'pipe' });
} catch (e) {
  fs.writeFileSync(SETTINGS, original, 'utf8');
  fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
}

log(SETTINGS + ': patched (2 edits)');
log('   - settings.html script: node --check OK\n');

log('Done.\n');
log('NEXT STEPS:');
log('  1. (Optional) Run patch45a-backfill.sql in Supabase to backfill');
log('     past referrals from before Patch 45a deployed.');
log('  2. git add -A');
log('  3. git commit -m "Patch 45a-fix: referral card UI + backfill SQL"');
log('  4. git push  (wait ~60s for Vercel)');
log('  5. Hard-refresh settings page  see the new card.\n');
