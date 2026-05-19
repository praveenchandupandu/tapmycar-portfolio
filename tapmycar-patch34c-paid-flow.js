// ============================================================================
// TapMyCar - Patch 34c: Paid/gifted user activation flow on physical tag scan
//
// Also re-runs Patch 34b-fix logic in case it wasn't deployed (safe to skip
// if marker already present).
//
// What this patch does:
//
// 1. verify-otp signin response now includes phone (34b-fix re-applied if
//    needed, guarded by marker).
//
// 2. contact.html proceedFromWelcome() considers a user signed-in if only
//    tmc_token is present (already from 34b-fix).
//
// 3. contact.html startActivation():
//    - If user is signed in AND has plan='standard'/'premium'/'business'
//      (paid OR gifted), enter the streamlined paid-flow:
//        a. Auto-mark email as verified (they just signed in)
//        b. Show only phone-OTP + vehicle details
//        c. Replace the $1 "Pay" button with "Activate Tag" (no charge)
//    - If signed in but plan='etag', show a "you need a plan" screen
//      with a link to /pricing.html
//    - If not signed in, existing identity flow
//
// 4. New finishActivationPaidUser() function called after vehicle review:
//    - POST /api/get-tag with token + user_id + activation_session + vehicle
//      details (the existing claim path)
//    - On success, deactivate user's old eTag (if any)
//    - Show success screen, then redirect to dashboard
//
// 5. step3 review screen: button text changes to "Activate Tag" (not
//    "Pay $1") when in paid-user mode; calls finishActivationPaidUser
//    instead of activateAndPay.
//
// Properties: idempotent, safe-replace (no $-token bugs), backs up files.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34c-${ts}`);

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
log('TapMyCar Patch 34c \u2014 paid/gifted user activation flow');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_BFIX = 'TMC_PATCH34BFIX_PHONE';
const MARKER_C = 'TMC_PATCH34C_PAID_FLOW';

// ===========================================================================
// 34c.0  Re-apply 34b-fix to verify-otp if missing (signin returns phone)
// ===========================================================================

log('34c.0  api/verify-otp.js: ensure 34b-fix is present');
{
  const file = path.join(API, 'verify-otp.js');
  const content = readFile(file);
  if (content.includes(MARKER_BFIX)) {
    skip('verify-otp.js (34b-fix already present)');
  } else {
    backup(file);
    const oldRet = `    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      isNewUser
    });`;
    const newRet = `    /* ${MARKER_BFIX}: include phone so signin.html saves a real phone value */
    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      isNewUser
    });`;
    const r = safeReplace(content, oldRet, newRet);
    if (!r) errExit('verify-otp.js: signin response anchor not found');
    writeFile(file, r);
    ok('verify-otp.js: phone now included in signin response');
  }
}

// ===========================================================================
// 34c.1  contact.html: 34b-fix tolerant session check + 34c paid-flow logic
// ===========================================================================

log('');
log('34c.1  public/contact.html: tolerant session check + paid-flow');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);

  let updated = content;
  let any = false;

  // Ensure 34b-fix proceedFromWelcome tolerant check is in place
  if (!updated.includes(MARKER_BFIX)) {
    const oldFn = `function proceedFromWelcome() {
  try {
    var sToken = localStorage.getItem('tmc_token');
    var sPhone = localStorage.getItem('tmc_phone');
    var sName = localStorage.getItem('tmc_name');
    var sEmail = localStorage.getItem('tmc_email');
    if (sToken && sPhone && sName && sEmail) {
      // Already signed in \u2014 skip identity check, run existing activation
      startActivation();
      return;
    }
  } catch (e) {}
  showState('identity');
}`;
    const newFn = `function proceedFromWelcome() {
  /* ${MARKER_BFIX}: tmc_token alone is sufficient. Phone/name/email are
     convenience prefill, not session credentials. */
  try {
    var sToken = localStorage.getItem('tmc_token');
    if (sToken) {
      startActivation();
      return;
    }
  } catch (e) {}
  showState('identity');
}`;
    const r = safeReplace(updated, oldFn, newFn);
    if (r) { updated = r; any = true; ok('contact.html: tolerant proceedFromWelcome applied'); }
  } else {
    skip('proceedFromWelcome (34b-fix already in)');
  }

  if (updated.includes(MARKER_C)) {
    skip('contact.html paid-flow (34c already in)');
  } else {
    backup(file);

    // Replace startActivation entirely with the new dispatcher
    const oldStart = `async function startActivation(){
  const token=localStorage.getItem('tmc_token');
  const phone=localStorage.getItem('tmc_phone');
  const name=localStorage.getItem('tmc_name');
  const email=localStorage.getItem('tmc_email');
  if(token&&phone&&name&&email){
    registrationData={name,email,phone,userId:token};
    showState('verify-existing');
    document.getElementById('existing-phone-masked').textContent=maskPhone(phone);
    document.getElementById('existing-email-masked').textContent=maskEmail(email);
    phoneVerified=false;emailVerified=false;
    document.getElementById('existing-continue-btn').style.opacity='.3';
    document.getElementById('existing-continue-btn').disabled=true;
    document.getElementById('phone-verified-badge').style.display='none';
    document.getElementById('email-verified-badge').style.display='none';
    document.getElementById('send-phone-btn').style.display='block';
    document.getElementById('send-email-btn').style.display='block';
    document.getElementById('phone-otp-row').style.display='none';
    document.getElementById('email-otp-row').style.display='none';
    document.getElementById('verify-phone-btn').style.display='none';
    document.getElementById('verify-email-btn').style.display='none';
  }else{
    showState('step1');`;

    const oldStartAlt = oldStart; // exact match expected

    // We will replace ONLY the function-internal start (lines before the
    // body close was already different per 34b-fix). Find a simpler anchor.

    // Anchor: the literal call signature + first lines
    const anchorSimple = `async function startActivation(){
  let token=localStorage.getItem('tmc_token');`;

    if (!updated.includes(anchorSimple) && !updated.includes(anchorSimple.replace(/\n/g, '\r\n'))) {
      // 34b-fix not applied yet; we need to also rewrite startActivation
      // entirely. Anchor on the original first line.
      const veryFirstLine = `async function startActivation(){
  const token=localStorage.getItem('tmc_token');
  const phone=localStorage.getItem('tmc_phone');
  const name=localStorage.getItem('tmc_name');
  const email=localStorage.getItem('tmc_email');`;
      if (!updated.includes(veryFirstLine) && !updated.includes(veryFirstLine.replace(/\n/g, '\r\n'))) {
        errExit('contact.html: startActivation anchor not found in either form');
      }
    }

    // Strategy: find the "isPaidUser" decision spot. We'll surgically add
    // an early-return path BEFORE the existing verify-existing setup. The
    // simplest way is to wrap the existing function body via a function
    // append. We do this by adding paidUserMode + new screens, and
    // intercepting verify-existing via a hook.

    // Add the new helpers + state HTML right before the closing </script>.
    // Find a unique anchor late in the file.
    const lateAnchor = `loadTag();

let selectedRating = 0;`;

    const paidFlowInjection = `// ${MARKER_C}: paid-user (and gifted-plan) activation flow.
// When a user is signed in AND has plan standard/premium/business, scanning
// an unclaimed physical tag goes through this streamlined path:
//   - email auto-verified (they just signed in)
//   - phone OTP still required (call forwarding depends on it)
//   - vehicle details still required (contact page needs them)
//   - NO payment (their plan covers this tag)

let p34cIsPaidUser = false;
let p34cUserPlan = 'etag';

async function p34cHydrateUser() {
  try {
    var tok = localStorage.getItem('tmc_token');
    if (!tok) return null;
    var r = await fetch('/api/get-dashboard?user_id=' + encodeURIComponent(tok));
    if (!r.ok) return null;
    var d = await r.json();
    if (!d || !d.user) return null;
    return d.user;
  } catch (e) { return null; }
}

async function p34cEnterPaidFlow(user) {
  /* User is signed in with a paid/gifted plan. Set up streamlined screen. */
  p34cIsPaidUser = true;
  p34cUserPlan = (user.plan || 'etag').toLowerCase();

  registrationData = {
    name: user.name || localStorage.getItem('tmc_name') || '',
    email: user.email || localStorage.getItem('tmc_email') || '',
    phone: user.phone || localStorage.getItem('tmc_phone') || '',
    userId: user.id || localStorage.getItem('tmc_token')
  };

  showState('verify-existing');

  /* Set masked displays */
  try {
    document.getElementById('existing-phone-masked').textContent =
      registrationData.phone ? maskPhone(registrationData.phone) : '\u2014';
    document.getElementById('existing-email-masked').textContent =
      registrationData.email ? maskEmail(registrationData.email) : '\u2014';
  } catch (e) {}

  /* Email: pre-mark as verified, hide its send/verify controls */
  phoneVerified = false; emailVerified = true;
  var eb = document.getElementById('email-verified-badge');
  if (eb) eb.style.display = 'inline-flex';
  var se = document.getElementById('send-email-btn');
  if (se) se.style.display = 'none';
  var ve = document.getElementById('verify-email-btn');
  if (ve) ve.style.display = 'none';
  var eor = document.getElementById('email-otp-row');
  if (eor) eor.style.display = 'none';

  /* Phone: still needs verification */
  var pb = document.getElementById('phone-verified-badge');
  if (pb) pb.style.display = 'none';
  var sp = document.getElementById('send-phone-btn');
  if (sp) sp.style.display = 'block';
  var por = document.getElementById('phone-otp-row');
  if (por) por.style.display = 'none';
  var vp = document.getElementById('verify-phone-btn');
  if (vp) vp.style.display = 'none';

  /* Continue button stays disabled until phone is verified.
     checkBothVerified() requires phoneVerified && emailVerified, and
     emailVerified is already true, so verifying phone enables Continue. */
  var cb = document.getElementById('existing-continue-btn');
  if (cb) { cb.style.opacity = '.3'; cb.disabled = true; }

  /* Update the welcome-back subtitle to acknowledge their plan */
  var planLabel = p34cUserPlan.charAt(0).toUpperCase() + p34cUserPlan.slice(1);
  var heading = document.querySelector('#state-verify-existing div[style*="font-size:15px"]');
  if (heading) heading.textContent = 'Welcome back!';
  var sub = document.querySelector('#state-verify-existing div[style*="font-size:13px"][style*="color:#6B7280"]');
  if (sub) sub.textContent = 'Verify your phone to activate this tag on your ' + planLabel + ' plan.';
}

function p34cShowNoPlanRequired() {
  /* Free-plan signed-in user. Block activation, send to pricing. */
  document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif;background:#fff">' +
    '<div style="max-width:340px;width:100%;text-align:center">' +
      '<div style="width:64px;height:64px;border-radius:18px;background:#FFF3EC;display:flex;align-items:center;justify-content:center;margin:0 auto 18px">' +
        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
        '</svg>' +
      '</div>' +
      '<div style="font-size:22px;font-weight:800;color:#111;margin-bottom:8px">A plan is required</div>' +
      '<div style="font-size:13.5px;color:#6B7280;line-height:1.55;margin-bottom:24px">Activating a physical TapMyCar tag requires a Standard, Premium, or Business plan. Pick one to activate your tag.</div>' +
      '<a href="/pricing.html?return=' + encodeURIComponent(window.location.pathname) + '" style="display:block;background:#FF6B00;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 24px;border-radius:14px;margin-bottom:10px">View Plans</a>' +
      '<a href="/dashboard.html" style="display:block;font-size:13px;color:#6B7280;text-decoration:none;padding:10px">Go to Dashboard</a>' +
    '</div>' +
  '</div>';
}

/* Backend-call wrapper for the activate-without-payment path. */
async function p34cActivateWithoutPayment() {
  /* Requires: registrationData.userId, current activation_session_id,
     vehicle details from step2/3, currentToken. */
  var btn = document.getElementById('pay-btn');
  if (btn) { btn.textContent = 'Activating...'; btn.disabled = true; }
  try {
    var body = {
      token: currentToken,
      user_id: registrationData.userId,
      license_plate: registrationData.license_plate || null,
      car_make: registrationData.car_make || null,
      car_model: registrationData.car_model || null,
      car_year: registrationData.car_year || null,
      car_color: registrationData.car_color || null,
      activation_session_id: (window.activationSessionId || '')
    };
    var r = await fetch('/api/get-tag', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    var data = await r.json();
    if (!r.ok || !data || !data.success && !data.tag) {
      showToast((data && data.error) || 'Activation failed');
      if (btn) { btn.textContent = 'Activate Tag'; btn.disabled = false; }
      return;
    }
    /* Deactivate user's OLD eTag (if different from this one). */
    try {
      var dr = await fetch('/api/get-dashboard?user_id=' + encodeURIComponent(registrationData.userId));
      var dd = await dr.json();
      if (dd && dd.tags) {
        for (var i = 0; i < dd.tags.length; i++) {
          var t = dd.tags[i];
          if (t.token && t.token !== currentToken && t.tag_type === 'etag' && t.status === 'active') {
            await fetch('/api/get-tag', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ token: t.token, user_id: registrationData.userId, status_override: 'inactive' })
            });
          }
        }
      }
    } catch (e) { /* non-fatal */ }
    /* Success: go to dashboard. */
    showState('success');
    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1500);
  } catch (e) {
    showToast('Network error');
    if (btn) { btn.textContent = 'Activate Tag'; btn.disabled = false; }
  }
}

/* Hook into pay button click \u2014 if paid-user mode, route to no-payment path. */
function p34cInstallPayButtonHook() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  btn.addEventListener('click', function(ev) {
    if (p34cIsPaidUser) {
      ev.preventDefault();
      ev.stopPropagation();
      p34cActivateWithoutPayment();
    }
    /* else fall through to existing activateAndPay() */
  }, true /* useCapture so we run before activateAndPay */);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', p34cInstallPayButtonHook);
} else {
  p34cInstallPayButtonHook();
}

/* Update the pay button label dynamically when entering paid mode. */
function p34cUpdatePayButtonLabel() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  if (p34cIsPaidUser) {
    btn.textContent = 'Activate Tag';
  }
}
/* Patch showState to refresh button label when step4 is shown. */
(function() {
  var origShowState = window.showState;
  if (typeof origShowState === 'function') {
    window.showState = function(id) {
      var r = origShowState.apply(this, arguments);
      if (id === 'step4') {
        setTimeout(p34cUpdatePayButtonLabel, 30);
        /* Also auto-enable the pay button for paid users (no need to check
           a consent checkbox \u2014 they already agreed via signup). */
        if (p34cIsPaidUser) {
          var btn = document.getElementById('pay-btn');
          if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
        }
      }
      return r;
    };
  }
})();

loadTag();

let selectedRating = 0;`;

    let r = safeReplace(updated, lateAnchor, paidFlowInjection);
    if (!r) errExit('contact.html: lateAnchor not found (loadTag() position)');
    updated = r;

    // Now rewrite startActivation to delegate to the paid flow if applicable.
    // The function may already be modified by 34b-fix. Try both anchors.
    const sa_a = `async function startActivation(){
  let token=localStorage.getItem('tmc_token');`;
    const sa_b = `async function startActivation(){
  const token=localStorage.getItem('tmc_token');`;

    var saReplacement = `async function startActivation(){
  /* ${MARKER_C}: dispatcher \u2014 if signed-in paid/gifted user, route to
     the streamlined paid-flow. Otherwise fall through to the existing
     new-user registration path. */
  var _ptok = localStorage.getItem('tmc_token');
  if (_ptok) {
    var _puser = await p34cHydrateUser();
    if (_puser) {
      var _pp = String(_puser.plan || 'etag').toLowerCase().trim();
      if (_pp === 'standard' || _pp === 'premium' || _pp === 'business') {
        await p34cEnterPaidFlow(_puser);
        return;
      }
      /* signed in, free plan -> block with pricing CTA */
      p34cShowNoPlanRequired();
      return;
    }
  }
  /* Not signed in (or hydrate failed) \u2014 existing new-user flow */
  let token=localStorage.getItem('tmc_token');`;

    if (updated.includes(sa_a)) {
      updated = updated.replace(sa_a, () => saReplacement);
      ok('contact.html: startActivation dispatcher installed (a)');
    } else if (updated.includes(sa_b)) {
      updated = updated.replace(sa_b, () => saReplacement.replace('let token=', 'const token='));
      ok('contact.html: startActivation dispatcher installed (b)');
    } else {
      errExit('contact.html: startActivation anchor not found in either form');
    }

    writeFile(file, updated);
    any = true;
  }

  if (!any) skip('contact.html (everything already in)');
}

log('');
log('==============================================================');
log('Patch 34c complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34c: paid/gifted user tag activation flow"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test plan:');
log('  Setup: gift Standard plan to your test user via admin panel.');
log('  Tag: any unclaimed verified TMC-XXXXX physical tag.');
log('  ');
log('  1. Clear localStorage in DevTools first.');
log('  2. Fresh incognito \u2192 sign in as the gifted user FIRST');
log('     (so we know signin works without the tag flow).');
log('  3. Now visit /tag/TMC-XXXXX:');
log('     - Welcome screen shows');
log('     - Click "Activate The Tag"');
log('     - Should land on "Welcome back!" screen with:');
log('       * Email row: "Verified" badge already (no Send code button)');
log('       * Phone row: Send code button visible');
log('       * Subtitle: "Verify your phone to activate this tag on your');
log('         Standard plan."');
log('  4. Tap Send code on phone, enter the SMS, verify phone.');
log('  5. Continue \u2192 step2 (vehicle details). Fill in.');
log('  6. step3 review screen \u2192 next.');
log('  7. step4: button reads "Activate Tag" (NOT "Pay $1"). Auto-enabled.');
log('     Click it.');
log('  8. Page goes to success screen, then redirects to /dashboard.html.');
log('  9. Dashboard: should show the NEW physical tag (TMC-XXXXX),');
log('     not the old eTag. The eTag is now inactive in DB.');
log('  10. Sanity: a user with plan=etag (no plan) doing the same flow');
log('      should hit the "A plan is required" screen with View Plans CTA.');
log('==============================================================');
