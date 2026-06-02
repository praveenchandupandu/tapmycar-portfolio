/* ============================================================================
 * TapMyCar  Patch 51b-fix  fix two real bugs in pre-delete retention flow
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch51b-fix.js
 *
 * Two real bugs in Patch 51b shipped earlier:
 *
 *   BUG 1: The probe call to /api/get-dashboard was missing the Auth header,
 *   so it 401'd silently. My catch comment said "fall through to delete" but
 *   the code actually fell through to showing the offer modal regardless of
 *   whether the user had already accepted. Result: users who already used
 *   the offer still saw the modal.
 *
 *   BUG 2: The "You've already used this offer before" red line inside the
 *   offer modal was nonsense. If the user is seeing the offer modal, they
 *   haven't already used it. The modal is the offer. The text never should
 *   have shipped. We delete it.
 *
 * Fix:
 *   - The probe sends the Authorization header (using tmc_session_token or
 *     tmc_token, same pattern as everywhere else in the app).
 *   - On probe failure (network error / 401), we do NOT show the offer; we
 *     fall through to the existing delete flow. Safer than showing an offer
 *     we can't verify.
 *   - The 'already_shown' code path in acceptRetentionOffer is rewritten:
 *     it no longer renders an inline red message  it closes the modal and
 *     proceeds with delete instead, because if the lock was already set,
 *     the user's intent (delete) is what we should honor.
 *
 * One file modified: public/settings.html
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH51B_FIX.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH51B_FIX';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch51b-fix-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const SETTINGS = path.join('public', 'settings.html');

/* ========================================================================
 * EDIT 1  fix the probe: send Auth header + truly fall-through on failure
 * ======================================================================*/

const PROBE_FIND = [
  "  /* TMC_PATCH51B: if the user hasn't been shown the retention offer yet,",
  "     pause here and show step 2. The actual delete only runs after the user",
  "     either accepts the offer (which short-circuits delete entirely) or",
  "     declines it (which then proceeds with delete). */",
  "  try {",
  "    var probe = await fetch('/api/get-dashboard');",
  "    if (probe.ok) {",
  "      var probeData = await probe.json();",
  "      var alreadyShown = probeData && probeData.user && probeData.user.retention_offer_shown_at;",
  "      if (!alreadyShown) {",
  "        __tmcPreDeleteState = { reasonCode: reasonCode, reasonText: reasonText, consent: consent };",
  "        showRetentionOffer();",
  "        return;",
  "      }",
  "    }",
  "  } catch (e) { /* fall through to delete on probe failure */ }"
].join('\n');

const PROBE_REPLACE = [
  "  /* TMC_PATCH51B_FIX: probe whether the user has already been shown the",
  "     retention offer. ONLY show the offer modal if we got a clean 200 AND",
  "     retention_offer_shown_at is null. Any error or non-null  fall through",
  "     to delete (the user's actual intent). Send auth header explicitly  the",
  "     original Patch 51b code omitted it, which silently 401'd and caused",
  "     the offer modal to show even for users who had already accepted. */",
  "  try {",
  "    var __tmcTok = s.token || localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token');",
  "    var probe = await fetch('/api/get-dashboard', {",
  "      headers: { 'Authorization': 'Bearer ' + __tmcTok }",
  "    });",
  "    if (probe.ok) {",
  "      var probeData = await probe.json();",
  "      var alreadyShown = probeData && probeData.user && probeData.user.retention_offer_shown_at;",
  "      if (!alreadyShown) {",
  "        __tmcPreDeleteState = { reasonCode: reasonCode, reasonText: reasonText, consent: consent };",
  "        showRetentionOffer();",
  "        return;",
  "      }",
  "      /* alreadyShown is truthy  user has used the offer before, proceed to delete. */",
  "    }",
  "    /* If probe failed or returned non-OK, also proceed to delete. The user",
  "       clicked Delete; respect that rather than show an offer we cannot",
  "       verify they are eligible for. */",
  "  } catch (e) { /* network error  fall through to delete */ }"
].join('\n');

/* ========================================================================
 * EDIT 2  remove the nonsensical 'already_shown' inline message
 *   The offer modal should never show "you already used this" because if
 *   it's showing, the user hasn't used it. Instead, if grant returns
 *   already_shown, we close the modal and proceed with delete (the user's
 *   intent was to delete; they detoured through the offer; the offer says
 *   nope, so let them out).
 * ======================================================================*/

const ACCEPT_FIND = [
  "    /* If already_shown comes back, the user already used this offer.",
  "       Close the modal and fall through to delete  honest. */",
  "    if (data && data.reason === 'already_shown') {",
  "      if (err) err.textContent = 'You\\'ve already used this offer before.';",
  "      if (btn) { btn.disabled = false; btn.textContent = 'Yes, keep my account'; }",
  "      if (dec) dec.disabled = false;",
  "      return;",
  "    }"
].join('\n');

const ACCEPT_REPLACE = [
  "    /* TMC_PATCH51B_FIX: if already_shown comes back, the server has the",
  "       lock set but somehow the modal slipped through. Close it and proceed",
  "       to delete  the user's actual intent. No nonsensical red text. */",
  "    if (data && data.reason === 'already_shown') {",
  "      closePreDelete();",
  "      /* Proceed to delete using cached pre-delete answers. */",
  "      if (typeof declineRetentionOffer === 'function') {",
  "        declineRetentionOffer();",
  "      }",
  "      return;",
  "    }"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 51b-fix  fix retention-offer probe + nonsense red text\n');
log('Backup -> ' + BACKUP_DIR + '\n');

if (!fs.existsSync(SETTINGS)) fail('settings.html not found');
const original = fs.readFileSync(SETTINGS, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(SETTINGS + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const edits = [
  { label: 'probe: send auth, true fall-through', find: PROBE_FIND,  replace: PROBE_REPLACE  },
  { label: 'accept: remove already_shown text',   find: ACCEPT_FIND, replace: ACCEPT_REPLACE }
];
for (const e of edits) {
  const i = updated.indexOf(e.find);
  if (i === -1) fail('pattern NOT FOUND  [' + e.label + ']');
  if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE  [' + e.label + ']');
  updated = updated.replace(e.find, () => e.replace);
}
if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(SETTINGS, path.join(BACKUP_DIR, SETTINGS));
fs.writeFileSync(SETTINGS, updated, 'utf8');

/* syntax-check the touched script */
const s = fs.readFileSync(SETTINGS, 'utf8');
const at = s.indexOf('TMC_PATCH51B_FIX: probe whether');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p51b-fix-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p51b-fix-chk.js', { stdio: 'pipe' });
    log(SETTINGS + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(SETTINGS, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. Clear your lock in Supabase FIRST so you can test fresh:');
log('       UPDATE public.users SET');
log('         retention_offer_shown_at    = NULL,');
log('         retention_offer_accepted_at = NULL,');
log('         retention_offer_exit_reason = NULL');
log('       WHERE referral_code = \'TMC-492TZD\';');
log('  2. git add -A');
log('  3. git commit -m "Patch 51b-fix: probe auth + remove nonsensical message"');
log('  4. git push  (wait ~60s for Vercel)');
log('  5. Settings  Delete account  reason  Permanently delete:');
log('     - Clean retention offer modal (no red line)');
log('     - Click Yes  $3 credit added, account stays');
log('     - Try delete AGAIN  should skip the offer and go straight to delete');
log('       confirmation, because the lock is now set.\n');
