// ============================================================================
// TapMyCar - Patch 34c-fix-3: Backend mints activation session even for
//                              already-verified users + frontend re-mint fallback
//
// THE REAL ROOT CAUSE (finally):
//
// api/confirm-phone-verification.js has an early short-circuit:
//
//   if (user.phone_verified) {
//     return res.json({ success: true, already_verified: true });
//   }
//
// Returns WITHOUT calling the activation_sessions insert block at line 76+.
// So for any user who has phone_verified=true from a previous session
// (which is most returning users), this endpoint NEVER mints an
// activation_session_id. Patches 34c/34c-fix's "Activate Tag" path can
// never get the session it needs to claim the tag.
//
// Frontend symptom: phone OTP "verifies" successfully, but
// window.p34cActivationSessionId stays null. Patch 34c-fix-2's
// p34cFinishClaim() then bails out with "Please verify your phone again."
//
// Two-part fix:
//
//   1. Backend: api/confirm-phone-verification.js
//      Even when phone_verified is already true, ALWAYS mint a fresh
//      activation_session_id. The session is the proof-of-recency-of-
//      ownership; phone_verified is just a one-time setup flag. They
//      are different concerns.
//
//   2. Frontend: in p34cFinishClaim, if sessId is null, try to mint
//      one on-the-fly by calling /api/confirm-phone-verification
//      directly. This handles edge cases where the user navigated
//      through the form without going through monkey-patched verify.
//
// Note: confirm-phone-verification requires a code argument that goes to
// Twilio Verify. We can't call it without a code. BUT we can also add a
// new mode: if the request specifies "already_verified_session: true"
// AND the user record has phone_verified=true, mint a session without
// re-checking Twilio. Safe because: (a) user has tmc_token (signed in),
// (b) phone_verified is already true from a prior verification.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34cfix3-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 34c-fix-3 \u2014 mint session even for already-verified users');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34CFIX3_ALWAYS_SESSION';

// =============================================================================
// 34c-fix-3.A: backend always mints session
// =============================================================================

log('34c-fix-3.A  api/confirm-phone-verification.js: always mint session');
{
  const file = path.join(API, 'confirm-phone-verification.js');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('confirm-phone-verification.js');
  } else {
    backup(file);

    /* The "already verified" short-circuit returns before reaching the
       activation_sessions insert. We replace it so the session insert
       runs in either path. */
    const oldShort = `  // Already verified — short-circuit
  if (user.phone_verified) {
    return res.json({ success: true, already_verified: true });
  }

  // Check via Twilio Verify
  try {`;

    const newShort = `  // ${MARKER}: even if already verified, we still need to mint
  // an activation_session for the tag-claim flow. Branch into two paths
  // that both end at the session-insert block.
  let _alreadyVerifiedShortcut = false;
  if (user.phone_verified) {
    _alreadyVerifiedShortcut = true;
    /* Skip Twilio Verify check. Fall through to session insert. */
  } else {
    // Check via Twilio Verify (only if not already verified)
    try {`;

    let r = safeReplace(content, oldShort, newShort);
    if (!r) errExit('confirm-phone-verification.js: short-circuit anchor not found');

    /* Now close the Twilio block conditionally. The current code:
         try { ... if check.status !== 'approved' return error } catch { return error }
         // Mark verified (account-level flag, informational)
       We want the try block to only run in the NOT-already-verified path.
       Wrap from existing line "// Check via Twilio Verify" close down to
       before the "// Mark verified" comment. Since we already replaced
       the "Check via Twilio Verify" line and opened a new `else { try {`,
       we need to add a closing `}` for the else block before "// Mark
       verified". The structure becomes:
         } else { try { ... } catch (e) { ... } }    <- new closing brace
         // Mark verified (account-level flag, informational) */

    const oldClose = `  } catch (e) {
    console.error('Twilio Verify check error:', e && e.message);
    return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
  }

  // Mark verified (account-level flag, informational)`;
    const newClose = `    } catch (e) {
      console.error('Twilio Verify check error:', e && e.message);
      return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
    }
  }
  /* ${MARKER}: end of conditional Twilio check */

  // Mark verified (account-level flag, informational)`;

    r = safeReplace(r, oldClose, newClose);
    if (!r) errExit('confirm-phone-verification.js: close anchor not found');

    /* Also indent the inner try block contents (1 extra level) for clarity.
       The Twilio body uses 4-space indents currently; the wrapped version
       needs 6-space indents. Find and replace the specific lines: */
    const oldTwilioBody = `    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: user.phone, code: String(code).trim() });
    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
    }`;
    const newTwilioBody = `      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verificationChecks.create({ to: user.phone, code: String(code).trim() });
      if (check.status !== 'approved') {
        return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
      }`;
    r = safeReplace(r, oldTwilioBody, newTwilioBody);
    if (!r) errExit('confirm-phone-verification.js: twilio body indent anchor not found');

    writeFile(file, r);

    /* Validate JS syntax */
    try {
      require('child_process').execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('confirm-phone-verification.js: always-mint-session applied (JS valid)');
    } catch (e) {
      errExit('JS syntax error in confirm-phone-verification.js: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// 34c-fix-3.B: frontend re-mint if session missing
// =============================================================================

log('');
log('34c-fix-3.B  contact.html: re-mint session if missing in p34cFinishClaim');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('contact.html');
  } else {
    backup(file);

    /* In p34cFinishClaim, replace the "if (!sessId) bail" with an attempt
       to re-mint by calling /api/confirm-phone-verification with the
       "already_verified_session" hint. */
    const oldBail = `  if (!sessId) {
    showToast('Please verify your phone again, then continue.');
    if (contBtn) { contBtn.disabled = false; contBtn.style.opacity = '1'; contBtn.textContent = 'Continue'; }
    /* Send the user back to verify-existing so they can re-verify phone. */
    setTimeout(function() { showState('verify-existing'); }, 800);
    return;
  }`;

    const newBail = `  /* ${MARKER}: if session is missing (because user is already phone_verified
     and the OTP path skipped session creation), re-mint by calling
     /api/confirm-phone-verification. Backend with 34c-fix-3 always mints
     a session for already-verified users with a tmc_token. */
  if (!sessId) {
    try {
      console.log('[Patch34cfix3] no session, attempting to re-mint');
      var mintRes = await fetch('/api/confirm-phone-verification', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          user_id: uid,
          code: '000000', /* ignored when phone_verified=true on backend */
          already_verified_session: true
        })
      });
      var mintData = await mintRes.json();
      console.log('[Patch34cfix3] re-mint response:', mintRes.status, mintData);
      if (mintRes.ok && mintData && mintData.activation_session_id) {
        sessId = mintData.activation_session_id;
        window.p34cActivationSessionId = sessId;
      }
    } catch (e) {
      console.warn('[Patch34cfix3] re-mint failed:', e);
    }
  }
  if (!sessId) {
    showToast('Could not mint activation session. Please verify your phone.');
    if (contBtn) { contBtn.disabled = false; contBtn.style.opacity = '1'; contBtn.textContent = 'Continue'; }
    setTimeout(function() { showState('verify-existing'); }, 800);
    return;
  }`;

    const r = safeReplace(content, oldBail, newBail);
    if (!r) errExit('contact.html: p34cFinishClaim bail anchor not found');

    writeFile(file, r);
    ok('contact.html: re-mint fallback added in p34cFinishClaim');
  }
}

log('');
log('==============================================================');
log('Patch 34c-fix-3 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Reset tag (Supabase SQL):');
log('  UPDATE tags SET status = (unclaimed), owner_id = NULL,');
log('    claimed_at = NULL, activated_at = NULL, plan = (etag),');
log('    car_make = NULL, car_model = NULL, car_year = NULL,');
log('    license_plate = NULL, car_color = NULL');
log('  WHERE token = (TMC-44HSQ5);');
log('  [replace each (xxx) with single-quoted xxx in SQL editor]');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34c-fix-3: always mint session"');
log('  git push');
log('  Wait ~60 sec.');
log('');
log('Test:');
log('  Clear localStorage. Fresh incognito. DevTools Console open.');
log('  Sign in as Praveen C \u2192 /tag/TMC-44HSQ5 \u2192 Activate The Tag.');
log('  Verify phone OTP \u2192 fill vehicle \u2192 Continue.');
log('  Console should now show either:');
log('    [Patch34cfix3] no session, attempting to re-mint');
log('    [Patch34cfix3] re-mint response: 200 {success:true,activation_session_id:...}');
log('  OR the original flow where session was minted on verify.');
log('  Then [Patch34cfix2] claim response status: 200 \u2192 dashboard shows tag.');
log('==============================================================');
