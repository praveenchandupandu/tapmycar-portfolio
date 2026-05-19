// ============================================================================
// TapMyCar - Patch 34b-fix: Sign-in returns phone + tolerant session check
//
// Bug discovered after Patch 34b deploy:
//
//   1. User scans unclaimed tag
//   2. Clicks "Activate The Tag" -> identity screen
//   3. Clicks "I'm already a TapMyCar user" -> /signin.html?continue=/tag/X
//   4. Signs in with email OTP -> returned to /tag/X (Patch 34b works)
//   5. Welcome screen reappears; clicks "Activate The Tag" again
//   6. proceedFromWelcome() checks:
//        if (sToken && sPhone && sName && sEmail) startActivation()
//        else showState('identity')
//      sToken/sName/sEmail are populated. sPhone is "" because the
//      verify-otp API does NOT include `phone` in the signin response.
//      saveSession(token, data.phone || '', name) saves an empty string,
//      and the welcome check considers the user "not signed in" \u2014 LOOP.
//
// Root cause: api/verify-otp.js (signin path) returns
//   { token, name, email, isNewUser }
// missing `phone`. signin.html saves the empty value to tmc_phone.
//
// Fix is two-part:
//
//   1. api/verify-otp.js: include user.phone in the email-OTP signin
//      response. Backend change \u2014 fixes the underlying data gap.
//
//   2. public/contact.html: make proceedFromWelcome() AND startActivation()
//      treat the user as signed-in if tmc_token alone is present. The
//      phone/name/email are convenience for prefilling the verify-existing
//      screen \u2014 if they're missing we can fall back to fetching the user
//      record from /api/get-dashboard (which contact.html already does
//      elsewhere). For now, the minimal fix: ignore empty phone in the
//      "is signed in" check, populate registrationData with sensible
//      defaults, and let verify-existing display whatever we have.
//
// Properties: idempotent. Uses safeReplace.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34bfix-${ts}`);

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
log('TapMyCar Patch 34b-fix \u2014 verify-otp returns phone + tolerant check');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34BFIX_PHONE';

// ===========================================================================
// 34b-fix.1  api/verify-otp.js: include phone in signin response
// ===========================================================================

log('34b-fix.1  api/verify-otp.js: include phone in email-OTP signin response');
{
  const file = path.join(API, 'verify-otp.js');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('verify-otp.js');
  } else {
    backup(file);

    const oldRet = `    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      isNewUser
    });`;

    const newRet = `    /* ${MARKER}: include phone so signin.html can saveSession() with a
       real phone value. Without this, tmc_phone is saved as "" and the
       welcome-page "is signed in" check (which requires phone) fails. */
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
// 34b-fix.2  contact.html: tolerate missing phone/name/email in session check
// ===========================================================================

log('');
log('34b-fix.2  contact.html: tolerate missing fields in proceedFromWelcome');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('contact.html');
  } else {
    backup(file);

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
  /* ${MARKER}: tmc_token alone is sufficient to know the user is signed in.
     Phone/name/email are convenience fields used to prefill verify-existing.
     Old check required all 4, which broke when the signin response was
     missing phone (verify-otp.js didn't return it). */
  try {
    var sToken = localStorage.getItem('tmc_token');
    if (sToken) {
      // Already signed in \u2014 skip identity check
      startActivation();
      return;
    }
  } catch (e) {}
  showState('identity');
}`;

    let updated = safeReplace(content, oldFn, newFn);
    if (!updated) errExit('contact.html: proceedFromWelcome anchor not found');

    // Also patch startActivation() so it doesn't bail to step1 when the
    // user IS signed in but missing one of phone/name/email. Fetch the
    // missing fields from /api/get-dashboard.
    const oldStart = `async function startActivation(){
  const token=localStorage.getItem('tmc_token');
  const phone=localStorage.getItem('tmc_phone');
  const name=localStorage.getItem('tmc_name');
  const email=localStorage.getItem('tmc_email');
  if(token&&phone&&name&&email){
    registrationData={name,email,phone,userId:token};
    showState('verify-existing');`;

    const newStart = `async function startActivation(){
  let token=localStorage.getItem('tmc_token');
  let phone=localStorage.getItem('tmc_phone');
  let name=localStorage.getItem('tmc_name');
  let email=localStorage.getItem('tmc_email');
  /* ${MARKER}: if signed in (token present) but missing phone/name/email,
     hydrate from /api/get-dashboard so we can still show verify-existing. */
  if (token && (!phone || !name || !email)) {
    try {
      const r = await fetch('/api/get-dashboard?user_id=' + encodeURIComponent(token));
      if (r.ok) {
        const d = await r.json();
        if (d && d.user) {
          if (!phone && d.user.phone) { phone = d.user.phone; localStorage.setItem('tmc_phone', phone); }
          if (!name && d.user.name)   { name  = d.user.name;  localStorage.setItem('tmc_name', name); }
          if (!email && d.user.email) { email = d.user.email; localStorage.setItem('tmc_email', email); }
        }
      }
    } catch (e) {}
  }
  if(token&&phone&&name&&email){
    registrationData={name,email,phone,userId:token};
    showState('verify-existing');`;

    updated = safeReplace(updated, oldStart, newStart);
    if (!updated) errExit('contact.html: startActivation anchor not found');

    writeFile(file, updated);
    ok('contact.html: proceedFromWelcome + startActivation hardened');
  }
}

log('');
log('==============================================================');
log('Patch 34b-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34b-fix: signin returns phone + tolerant check"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test plan:');
log('  1. Clear localStorage in your browser (DevTools > Application >');
log('     Local Storage > clear all for tapmycar.io).');
log('  2. Fresh incognito. Scan an unclaimed tag.');
log('  3. Click "Activate The Tag" \u2192 identity screen \u2192');
log('     "I am already a TapMyCar user" \u2192 /signin.html?continue=/tag/...');
log('  4. Sign in with email + OTP.');
log('  5. Land back on /tag/TMC-XXXXX.');
log('  6. Click "Activate The Tag":');
log('     a. Should NOT loop back to identity screen.');
log('     b. Should go directly to verify-existing (the phone/email');
log('        re-verification screen for upgrade).');
log('  7. Inspect localStorage in DevTools. Confirm tmc_phone now has a');
log('     real value (e.g. "+12035071533"), not empty string.');
log('==============================================================');
