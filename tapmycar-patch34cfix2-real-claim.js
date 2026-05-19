// ============================================================================
// TapMyCar - Patch 34c-fix-2: Real activation in goToStep2 signed-in branch
//
// THE ACTUAL ROOT CAUSE (finally found, after 2 wrong guesses):
//
// goToStep2() at the bottom of the vehicle-details step has this branch
// for signed-in users:
//
//   if(localStorage.getItem('tmc_token')){
//     saveVehicleDetails(registrationData.userId||...);  <-- 403, ignored
//     showState('success');                               <-- shown anyway
//   }
//
// saveVehicleDetails() calls /api/get-tag POST WITHOUT activation_session_id.
// The backend returns 403 "Phone verification required to activate this tag".
// The frontend catches the error silently (just console.error) and STILL
// shows the success screen. Result: tag is never claimed, but UI lies.
//
// Patches 34c and 34c-fix were designed for the step4 "Activate Tag" button,
// but the signed-in flow NEVER REACHES step4. It short-circuits from step2
// directly to success.
//
// Real fix: rewrite the signed-in branch in goToStep2 to do a proper
// claim with activation_session_id (which my 34c-fix already populates
// via the rewritten verifyPhoneOTP). If success, show success and
// redirect. If failure, show error and stay on the form.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34cfix2-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) { return fs.readFileSync(p, 'utf8'); }
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
log('TapMyCar Patch 34c-fix-2 \u2014 real activation in goToStep2 signed-in branch');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34CFIX2_REAL_CLAIM';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}

backup(file);

const oldBranch = `  if(localStorage.getItem('tmc_token')){
    saveVehicleDetails(registrationData.userId||localStorage.getItem('tmc_token'));
    showState('success');
  }else{
    sendPhoneOTP();
  }
}`;

const newBranch = `  if(localStorage.getItem('tmc_token')){
    /* ${MARKER}: this is the REAL activation path for signed-in users.
       The original code called saveVehicleDetails() (which 403s without
       activation_session_id) then showed success regardless. We now make
       a proper claim call that updates owner_id + status + plan, then
       only show success on actual success. */
    p34cFinishClaim();
  }else{
    sendPhoneOTP();
  }
}

/* ${MARKER}: Real claim flow for signed-in users. Called from goToStep2
   when user has tmc_token in localStorage. */
async function p34cFinishClaim() {
  /* Disable the Continue button to prevent double-submits */
  var contBtn = document.querySelector('#state-step2 .btn');
  if (contBtn) { contBtn.disabled = true; contBtn.style.opacity = '.6'; contBtn.textContent = 'Activating...'; }

  var uid = registrationData.userId || localStorage.getItem('tmc_token');
  var sessId = window.p34cActivationSessionId || null;

  if (!sessId) {
    showToast('Please verify your phone again, then continue.');
    if (contBtn) { contBtn.disabled = false; contBtn.style.opacity = '1'; contBtn.textContent = 'Continue'; }
    /* Send the user back to verify-existing so they can re-verify phone. */
    setTimeout(function() { showState('verify-existing'); }, 800);
    return;
  }

  var body = {
    token: currentToken,
    user_id: uid,
    license_plate: registrationData.license_plate || null,
    car_make: registrationData.car_make || null,
    car_model: registrationData.car_model || null,
    car_year: registrationData.car_year || null,
    car_color: registrationData.car_color || null,
    activation_session_id: sessId
  };
  console.log('[Patch34cfix2] claim payload:', body);

  try {
    var r = await fetch('/api/get-tag', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    var data = null;
    try { data = await r.json(); } catch(e) { data = null; }
    console.log('[Patch34cfix2] claim response status:', r.status, 'body:', data);

    if (!r.ok) {
      var msg = (data && data.error) || ('Activation failed (HTTP ' + r.status + ')');
      showToast(msg);
      if (contBtn) { contBtn.disabled = false; contBtn.style.opacity = '1'; contBtn.textContent = 'Continue'; }
      if (data && data.needs_phone_verification) {
        window.p34cActivationSessionId = null;
        phoneVerified = false;
        setTimeout(function() { showState('verify-existing'); }, 800);
      }
      return;
    }

    /* ${MARKER}: also set the tag's plan to match the user's plan,
       so dashboard shows it correctly. Backend doesn't auto-bump plan,
       so we POST a follow-up update. */
    try {
      var userPlan = (p34cUserPlan || 'standard').toLowerCase();
      if (userPlan && userPlan !== 'etag') {
        await fetch('/api/get-tag', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            token: currentToken,
            user_id: uid,
            plan: userPlan,
            status_override: 'active'  /* this is an UPDATE, not a fresh claim */
          })
        });
      }
    } catch (e) { console.warn('[Patch34cfix2] plan update failed:', e); }

    /* All good \u2014 show success and redirect. */
    showState('success');
    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1500);
  } catch (e) {
    console.error('[Patch34cfix2] network exception:', e);
    showToast('Network error');
    if (contBtn) { contBtn.disabled = false; contBtn.style.opacity = '1'; contBtn.textContent = 'Continue'; }
  }
}`;

const r = safeReplace(content, oldBranch, newBranch);
if (!r) errExit('contact.html: goToStep2 signed-in branch anchor not found');

writeFile(file, r);

const verify = readFile(file);
const hasMarker = verify.includes(MARKER);
const hasFinishClaim = verify.includes('function p34cFinishClaim');
const hasShortcircuitGone = !verify.includes("saveVehicleDetails(registrationData.userId||localStorage.getItem('tmc_token'));\n    showState('success');");

log('');
log('Verification:');
log('  marker present: ' + hasMarker);
log('  p34cFinishClaim defined: ' + hasFinishClaim);
log('  old short-circuit removed: ' + hasShortcircuitGone);

if (!hasMarker) errExit('marker missing');
if (!hasFinishClaim) errExit('p34cFinishClaim missing');
if (!hasShortcircuitGone) errExit('old short-circuit still present');

ok('contact.html: signed-in branch now does real claim');

log('');
log('==============================================================');
log('Patch 34c-fix-2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Reset the test tag first:');
log('  UPDATE tags SET status = (unclaimed), owner_id = NULL,');
log('    claimed_at = NULL, activated_at = NULL, plan = (etag),');
log('    car_make = NULL, car_model = NULL, car_year = NULL,');
log('    license_plate = NULL, car_color = NULL');
log('  WHERE token = (TMC-44HSQ5);');
log('  [replace (xxx) with single-quoted xxx in SQL]');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34c-fix-2: real activation in goToStep2"');
log('  git push');
log('');
log('Test:');
log('  Clear localStorage. Fresh incognito. Open DevTools Console.');
log('  Sign in as Praveen C \u2192 /tag/TMC-44HSQ5 \u2192 Activate The Tag.');
log('  Verify phone \u2192 fill vehicle details \u2192 Continue.');
log('  Watch console: should see "[Patch34cfix2] claim payload" with a');
log('  real activation_session_id (UUID).');
log('  Should see "[Patch34cfix2] claim response status: 200".');
log('  Then success screen \u2192 dashboard \u2192 TMC-44HSQ5 visible there.');
log('==============================================================');
