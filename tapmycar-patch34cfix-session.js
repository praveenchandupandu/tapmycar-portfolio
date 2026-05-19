// ============================================================================
// TapMyCar - Patch 34c-fix: Activation session + reliable pay button hook
//
// Bug found after Patch 34c deploy: paid-user activation completes the UI
// flow (vehicle details, OTP verification, "Activate Tag" click, success
// screen, dashboard redirect) but the database is NEVER updated. Tag stays
// unclaimed.
//
// Two root causes:
//
//   1. /api/get-tag POST (the claim endpoint) requires an
//      activation_session_id created via /api/confirm-phone-verification.
//      The existing paid checkout flow gets one via Stripe webhook auth.
//      Patch 34c's frontend p34cActivateWithoutPayment() passes an empty
//      string \u2014 backend returns 403. Frontend shows error toast but the
//      pay-btn's INLINE onclick="activateAndPay()" ALSO runs (because
//      addEventListener with capture/stopPropagation does NOT cancel
//      attribute-registered handlers reliably). activateAndPay() then
//      kicks off Stripe checkout via /api/create-checkout, which probably
//      either errors out or shows brief UI before the page navigates.
//
//   2. The hook design \u2014 layered listener on top of inline onclick \u2014 is
//      fragile. Replace inline onclick with a router function that picks
//      the right path based on p34cIsPaidUser.
//
// Fix:
//
//   A. After verifyPhoneOTP succeeds in paid-user mode, call
//      /api/confirm-phone-verification with the code to obtain a real
//      activation_session_id. Store it in window.p34cActivationSessionId.
//
//      BUT \u2014 verifyPhoneOTP currently uses /api/verify-otp (Twilio Verify
//      check). confirm-phone-verification ALSO calls Twilio Verify check
//      on the SAME code, which would fail because Twilio Verify codes are
//      one-shot. Solution: in paid-user mode, BYPASS verify-otp and call
//      confirm-phone-verification DIRECTLY (it both verifies AND creates
//      the session in one call). Set phoneVerified=true on its success.
//
//   B. Replace pay-btn's inline onclick handler with a router function
//      _p34cPayBtnClick() that dispatches based on p34cIsPaidUser.
//      Remove the fragile addEventListener hook.
//
//   C. Also collect vehicle details from step2 inputs into registrationData
//      before sending to /api/get-tag (currently they may not be populated
//      because step2 -> step3 -> step4 flow stores them differently).
//
// Properties: idempotent, safeReplace, backs up files.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34cfix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
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
log('TapMyCar Patch 34c-fix \u2014 activation session + reliable pay button hook');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34CFIX_SESSION';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}

backup(file);
let updated = content;

// ============================================================================
// Fix A: Replace verifyPhoneOTP in paid-user mode so it ALSO creates the
// activation_session_id by calling /api/confirm-phone-verification.
// ============================================================================

// We don't rewrite verifyPhoneOTP itself. Instead we monkey-patch it on
// load: save the original, wrap it so paid users go through a different
// path that uses confirm-phone-verification.

// Find the lateAnchor where 34c injected its functions \u2014 inject our new
// helpers right after the existing p34cInstallPayButtonHook block.

const lateAnchor = `if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', p34cInstallPayButtonHook);
} else {
  p34cInstallPayButtonHook();
}`;

const fixedInjection = `/* ${MARKER}: replace the fragile capture-phase hook with a direct router.
   The original Patch 34c approach (addEventListener capture +
   stopPropagation) did NOT reliably suppress the pay-btn's INLINE onclick
   attribute, so activateAndPay() also fired and started a Stripe checkout
   in parallel. We now REPLACE the inline onclick attribute entirely. */
function p34cInstallPayButtonHook() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  /* Remove any existing onclick attribute and set our router. */
  try { btn.removeAttribute('onclick'); } catch (e) {}
  btn.onclick = function() {
    if (p34cIsPaidUser) {
      p34cActivateWithoutPayment_v2();
      return;
    }
    /* Fall through to the original paid checkout flow. */
    try { activateAndPay(); } catch (e) { console.error(e); }
  };
}

/* ${MARKER}: monkey-patch verifyPhoneOTP so paid users go through
   /api/confirm-phone-verification (which ALSO creates an
   activation_session_id we need to claim the tag). */
window.p34cActivationSessionId = null;
(function() {
  var origVerify = window.verifyPhoneOTP;
  window.verifyPhoneOTP = async function() {
    if (!p34cIsPaidUser) {
      /* Not paid-user mode \u2014 use original verifier (Twilio Verify check
         via /api/verify-otp). */
      return origVerify.apply(this, arguments);
    }
    /* Paid-user mode: collect the 6-digit OTP, call
       /api/confirm-phone-verification which verifies AND mints session. */
    var boxes = document.querySelectorAll('#phone-otp-row .otp-box');
    var code = Array.from(boxes).map(function(b) { return b.value; }).join('');
    if (code.length < 6) { showToast('Enter all 6 digits'); return; }
    var btn = document.getElementById('verify-phone-btn');
    if (btn) { btn.textContent = 'Verifying...'; btn.disabled = true; }
    try {
      var uid = registrationData.userId || localStorage.getItem('tmc_token');
      var res = await fetch('/api/confirm-phone-verification', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_id: uid, code: code })
      });
      var data = await res.json();
      if (res.ok && data && data.success) {
        window.p34cActivationSessionId = data.activation_session_id || null;
        phoneVerified = true;
        var pvb = document.getElementById('phone-verified-badge');
        if (pvb) pvb.style.display = 'inline-flex';
        var pOtpRow = document.getElementById('phone-otp-row');
        if (pOtpRow) pOtpRow.style.display = 'none';
        if (btn) btn.style.display = 'none';
        if (typeof checkBothVerified === 'function') checkBothVerified();
      } else {
        showToast((data && data.error) || 'Wrong code');
        if (btn) { btn.textContent = 'Verify'; btn.disabled = false; }
      }
    } catch (e) {
      showToast('Network error');
      if (btn) { btn.textContent = 'Verify'; btn.disabled = false; }
    }
  };
})();

/* ${MARKER}: rewritten activation \u2014 reads the now-populated
   p34cActivationSessionId and the vehicle details from registrationData.
   The step2/step3/step4 flow stores them in registrationData via the
   existing collectStep2()/proceedToStep3() functions. */
async function p34cActivateWithoutPayment_v2() {
  var btn = document.getElementById('pay-btn');
  if (btn) { btn.textContent = 'Activating...'; btn.disabled = true; }

  /* Make sure step2 values are in registrationData. The existing
     flow's collectStep2() stores them. Re-collect in case step navigation
     didn't trigger it. */
  try {
    var lp = document.getElementById('s2-plate');
    var make = document.getElementById('s2-make');
    var model = document.getElementById('s2-model');
    var year = document.getElementById('s2-year');
    var color = document.getElementById('s2-color');
    if (lp && lp.value) registrationData.license_plate = lp.value.trim().toUpperCase();
    if (make && make.value) registrationData.car_make = make.value.trim();
    if (model && model.value) registrationData.car_model = model.value.trim();
    if (year && year.value) registrationData.car_year = year.value.trim();
    if (color && color.value) registrationData.car_color = color.value.trim();
  } catch (e) {}

  if (!window.p34cActivationSessionId) {
    showToast('Please verify your phone first.');
    if (btn) { btn.textContent = 'Activate Tag'; btn.disabled = false; }
    return;
  }

  try {
    var body = {
      token: currentToken,
      user_id: registrationData.userId,
      license_plate: registrationData.license_plate || null,
      car_make: registrationData.car_make || null,
      car_model: registrationData.car_model || null,
      car_year: registrationData.car_year || null,
      car_color: registrationData.car_color || null,
      activation_session_id: window.p34cActivationSessionId
    };
    console.log('Patch34c-fix: claim payload', body);
    var r = await fetch('/api/get-tag', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    var data = await r.json();
    console.log('Patch34c-fix: claim response', r.status, data);
    if (!r.ok || (!data.success && !data.tag)) {
      showToast((data && data.error) || 'Activation failed');
      if (btn) { btn.textContent = 'Activate Tag'; btn.disabled = false; }
      /* If session expired/invalid, clear it so next attempt re-verifies. */
      if (data && data.needs_phone_verification) {
        window.p34cActivationSessionId = null;
        phoneVerified = false;
        var pvb = document.getElementById('phone-verified-badge');
        if (pvb) pvb.style.display = 'none';
      }
      return;
    }
    /* The backend already auto-deactivates the user's eTags when a
       physical tag is activated (see get-tag.js lines 145-160), so the
       frontend doesn't need to do that step. */
    showState('success');
    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1500);
  } catch (e) {
    console.error('Patch34c-fix exception:', e);
    showToast('Network error');
    if (btn) { btn.textContent = 'Activate Tag'; btn.disabled = false; }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', p34cInstallPayButtonHook);
} else {
  p34cInstallPayButtonHook();
}`;

const r = safeReplace(updated, lateAnchor, fixedInjection);
if (!r) errExit('contact.html: late hook anchor not found');
updated = r;
ok('Reliable pay button router + activation session helpers installed');

// ============================================================================
// Also: when entering paid flow, clear any stale activation session.
// ============================================================================

const enterPaidAnchor = `async function p34cEnterPaidFlow(user) {
  /* User is signed in with a paid/gifted plan. Set up streamlined screen. */
  p34cIsPaidUser = true;`;

const enterPaidNew = `async function p34cEnterPaidFlow(user) {
  /* User is signed in with a paid/gifted plan. Set up streamlined screen. */
  /* ${MARKER}: clear any stale activation session from a previous attempt */
  window.p34cActivationSessionId = null;
  p34cIsPaidUser = true;`;

const r2 = safeReplace(updated, enterPaidAnchor, enterPaidNew);
if (!r2) errExit('contact.html: p34cEnterPaidFlow anchor not found');
updated = r2;
ok('Stale activation session cleared on entering paid flow');

// ============================================================================
// Write + verify
// ============================================================================

writeFile(file, updated);

const final = readFile(file);
const markerCount = (final.match(new RegExp(MARKER, 'g')) || []).length;
const hasV2 = final.includes('p34cActivateWithoutPayment_v2');
const hasConfirmCall = final.includes('/api/confirm-phone-verification');
const hasMonkeyPatch = final.includes('window.verifyPhoneOTP = async function');
const hasOnclickRemoval = final.includes("btn.removeAttribute('onclick')");
const scriptsBalanced = (final.match(/<script/g) || []).length === (final.match(/<\/script>/g) || []).length;

log('');
log('Verification:');
log('  ' + MARKER + ' markers: ' + markerCount + ' (>=2 expected)');
log('  p34cActivateWithoutPayment_v2 present: ' + hasV2);
log('  /api/confirm-phone-verification call present: ' + hasConfirmCall);
log('  verifyPhoneOTP monkey-patch present: ' + hasMonkeyPatch);
log('  Inline onclick removal present: ' + hasOnclickRemoval);
log('  script tags balanced: ' + scriptsBalanced);

if (markerCount < 2) errExit('Marker count too low');
if (!hasV2) errExit('v2 activation function missing');
if (!hasConfirmCall) errExit('confirm-phone-verification call missing');
if (!hasMonkeyPatch) errExit('verifyPhoneOTP monkey-patch missing');
if (!hasOnclickRemoval) errExit('onclick removal missing');
if (!scriptsBalanced) errExit('Script tags unbalanced');

ok('contact.html verified');

log('');
log('==============================================================');
log('Patch 34c-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34c-fix: activation session + reliable pay button"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Reset before testing:');
log('  Manually re-link the tag from a clean state. Run this SQL in Supabase:');
log('');
log('    UPDATE tags SET status = (unclaimed), owner_id = NULL, claimed_at = NULL,');
log('      activated_at = NULL, plan = (etag), car_make = NULL, car_model = NULL,');
log('      car_year = NULL, license_plate = NULL, car_color = NULL');
log('    WHERE token = (TMC-44HSQ5);');
log('    [replace each (xxx) with single-quoted xxx]');
log('');
log('  (Leave verified = true; the manufacturer-verified flag stays.)');
log('');
log('Test plan:');
log('  1. Clear localStorage in DevTools.');
log('  2. Fresh incognito \u2192 sign in as Praveen C.');
log('  3. Visit /tag/TMC-44HSQ5.');
log('  4. Welcome \u2192 click "Activate The Tag".');
log('  5. Welcome-back screen: email pre-verified, phone needs SMS.');
log('  6. Send SMS code \u2192 enter the 6 digits \u2192 Verify.');
log('     a. Open DevTools Console BEFORE clicking verify so you can see logs.');
log('     b. Should see no "Wrong code" error.');
log('     c. Phone shows Verified badge.');
log('  7. Continue \u2192 fill vehicle details (year/make/model/plate/color) \u2192 next.');
log('  8. Review screen \u2192 next.');
log('  9. Pay button reads "Activate Tag" \u2014 click.');
log('     a. Console should log "Patch34c-fix: claim payload" with full body');
log('        including activation_session_id (a UUID).');
log('     b. Console should log "Patch34c-fix: claim response" with status 200');
log('        and the tag object.');
log('  10. Success screen \u2192 redirect to dashboard.');
log('  11. Dashboard should now show TMC-44HSQ5 (NOT the old eTag).');
log('  12. SQL check: tag TMC-44HSQ5 should have status=active, plan=standard,');
log('      owner_id=Praveen C, car details populated.');
log('==============================================================');
