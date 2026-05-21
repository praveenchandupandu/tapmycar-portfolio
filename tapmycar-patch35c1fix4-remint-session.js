// ============================================================================
// TapMyCar - Patch 35c-1-fix-4: Re-mint activation session in the gift claim
//
// Bug (from user screenshot): a NEW user claiming a gift tag verifies their
// phone, reaches the gift Step 4, taps "Activate Tag" -> toast says
// "Please verify your phone first." even though the phone WAS verified.
//
// Cause: two phone-verify paths set different things.
//   - Existing-user paid path uses /api/confirm-phone-verification, which
//     returns an activation_session_id, stored in window.p34cActivationSessionId.
//   - NEW-user path (verifyAndContinue) uses /api/verify-otp, which does
//     NOT return an activation_session_id. So window.p34cActivationSessionId
//     stays null.
//
// p34cActivateWithoutPayment_v2() (the claim used by the gift flow) hard-
// requires window.p34cActivationSessionId and bails with the misleading
// "verify your phone" toast when it is missing.
//
// Fix: give p34cActivateWithoutPayment_v2() the SAME re-mint fallback the
// paid path already uses (Patch 34c-fix-3). When the session is missing,
// call /api/confirm-phone-verification with already_verified_session:true.
// The new user IS phone_verified at this point (verify-otp set it), so the
// backend mints a fresh session. Proven pattern, copied verbatim.
//
// One file: public/contact.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1fix4-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
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
log('TapMyCar Patch 35c-1-fix-4 \u2014 re-mint activation session in gift claim');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1FIX4_REMINT_SESSION';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}
backup(file);

/* Replace the hard bail with a re-mint-then-bail. The re-mint mirrors the
   paid path's Patch 34c-fix-3 logic. */
const oldBail = `  if (!window.p34cActivationSessionId) {
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
    };`;

const newBail = `  /* ${MARKER}: if no session (new-user verify-otp path does not mint one),
     re-mint via confirm-phone-verification. The user IS phone_verified by
     now, so the backend (Patch 34c-fix-3) mints a fresh session. */
  if (!window.p34cActivationSessionId) {
    var _uidRM = registrationData.userId || localStorage.getItem('tmc_token');
    if (_uidRM) {
      try {
        var _mintRes = await fetch('/api/confirm-phone-verification', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            user_id: _uidRM,
            code: '000000',
            already_verified_session: true
          })
        });
        var _mintData = await _mintRes.json();
        if (_mintRes.ok && _mintData && _mintData.activation_session_id) {
          window.p34cActivationSessionId = _mintData.activation_session_id;
        }
      } catch (e) {
        console.warn('${MARKER}: re-mint failed:', e);
      }
    }
  }
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
    };`;

const r = safeReplace(content, oldBail, newBail);
if (!r) errExit('contact.html: p34cActivateWithoutPayment_v2 bail anchor not found');

writeFile(file, r);

const verify = readFile(file);
if (!verify.includes(MARKER)) errExit('marker missing after write');
const remintCount = (verify.match(/already_verified_session/g) || []).length;
/* Should now be 2: the original paid-path one + our new gift-path one */
if (remintCount < 2) errExit('re-mint block not added (already_verified_session count=' + remintCount + ')');
ok('p34cActivateWithoutPayment_v2: session re-mint fallback added');

log('');
log('==============================================================');
log('Patch 35c-1-fix-4 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1-fix-4: re-mint activation session in gift claim"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test (new user, gift tag):');
log('  1. HARD REFRESH (force-close browser or fresh incognito).');
log('  2. Tap a gift sticker as a new user -> register -> verify phone');
log('     -> gift Step 4 -> tap "Activate Tag".');
log('  3. No more "Please verify your phone first." It should claim the');
log('     tag and redirect to the dashboard.');
log('  4. Confirm in Supabase:');
log('     SELECT plan, gift_plan_starts_at, gift_plan_expires_at FROM users');
log('       WHERE id = (the new user id);');
log('     -> plan = standard, expiry ~1 month out.');
log('==============================================================');
