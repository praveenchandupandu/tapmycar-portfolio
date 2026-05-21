// ============================================================================
// TapMyCar - Patch 35c-1-fix-5: verify-otp marks phone_verified
//
// Root cause chain for "Please verify your phone first" on the gift claim:
//
//   1. A NEW user verifies their phone through the new-user flow, which
//      calls /api/verify-otp (type:'phone'). verify-otp.js checks the code
//      with Twilio Verify -- but NEVER sets users.phone_verified = true.
//   2. The gift claim (p34cActivateWithoutPayment_v2) needs an activation
//      session. For new users there is none, so Patch 35c-1-fix-4 re-mints
//      one by calling /api/confirm-phone-verification with
//      already_verified_session:true.
//   3. confirm-phone-verification only takes the no-Twilio "already
//      verified" shortcut when users.phone_verified is true. Because step 1
//      never set it, the endpoint instead tries to verify code '000000'
//      via Twilio, Twilio rejects it, and the re-mint fails.
//   4. No session -> "Please verify your phone first."
//
// Fix: in verify-otp.js, after the Twilio phone check passes, set
// phone_verified = true (and phone_verified_at) on the user row. Then the
// re-mint shortcut works and the gift claim succeeds.
//
// This also makes phone_verified accurate for ALL users who verify via the
// new-user OTP path -- previously that flag was only set by the separate
// confirm-phone-verification endpoint, so new users had it stuck at false.
//
// One file: api/verify-otp.js. Idempotent, safeReplace, backup, JS check.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1fix5-${ts}`);

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
log('TapMyCar Patch 35c-1-fix-5 \u2014 verify-otp marks phone_verified');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1FIX5_PHONE_VERIFIED';

const file = path.join(API, 'verify-otp.js');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('verify-otp.js (already patched)');
  process.exit(0);
}
backup(file);

/* Anchor: the phone-OTP branch, right after the user is found/created and
   before the response is returned. We add a phone_verified update. */
const oldBlock = `    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
    let isNewUser = false;
    if (!user) {
      const { data: newUser } = await supabase.from('users')
        .insert({ phone, name: name || 'User', email: email || '' })
        .select().single();
      user = newUser;
      isNewUser = true;
    }
    if (isNewUser && user) await assignFreeTag(user.id);
    return res.json({ token: user.id, name: user.name, phone: user.phone });`;

const newBlock = `    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
    let isNewUser = false;
    if (!user) {
      const { data: newUser } = await supabase.from('users')
        .insert({ phone, name: name || 'User', email: email || '' })
        .select().single();
      user = newUser;
      isNewUser = true;
    }
    if (isNewUser && user) await assignFreeTag(user.id);

    /* ${MARKER}: the Twilio phone OTP check above passed, so this phone is
       genuinely verified. Persist phone_verified so the activation-session
       re-mint path (confirm-phone-verification) can take its no-Twilio
       shortcut. Without this, new users have phone_verified stuck at false
       and the gift-claim re-mint fails with "verify your phone first". */
    if (user && user.id) {
      try {
        await supabase
          .from('users')
          .update({ phone_verified: true, phone_verified_at: new Date().toISOString() })
          .eq('id', user.id);
      } catch (pvErr) {
        console.error('${MARKER}: phone_verified update failed:', pvErr && pvErr.message);
        /* non-fatal: verification still succeeded for the caller */
      }
    }

    return res.json({ token: user.id, name: user.name, phone: user.phone });`;

const r = safeReplace(content, oldBlock, newBlock);
if (!r) errExit('verify-otp.js: phone-OTP branch anchor not found');

writeFile(file, r);

try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
} catch (e) {
  errExit('verify-otp.js JS error: ' + e.stderr.toString());
}

const verify = readFile(file);
if (!verify.includes(MARKER)) errExit('marker missing after write');
ok('verify-otp.js: phone_verified now set after a successful phone OTP');

log('');
log('==============================================================');
log('Patch 35c-1-fix-5 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('This is the last link in the chain. With this:');
log('  new user verifies phone -> phone_verified = true ->');
log('  gift-claim re-mint (fix-4) can mint a session ->');
log('  the claim succeeds, no more "verify your phone first".');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1-fix-5: verify-otp marks phone_verified"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('IMPORTANT: this patch + Patch 35c-1-fix-4 work TOGETHER. Make sure');
log('BOTH are deployed. If fix-4 was never pushed, deploy it too.');
log('');
log('Test (new user, gift tag):');
log('  1. HARD REFRESH (force-close browser / fresh incognito).');
log('  2. Use a NEW phone number (one not already in the users table),');
log('     so it is a genuinely new user.');
log('  3. Tap a gift sticker -> register -> verify phone -> gift Step 4');
log('     -> tap "Activate Tag".');
log('  4. Should claim successfully and redirect to dashboard. No error.');
log('  5. Supabase check:');
log('     SELECT phone_verified, plan, gift_plan_expires_at FROM users');
log('       WHERE phone = (the test phone);');
log('     -> phone_verified=true, plan=standard, expiry ~1 month out.');
log('==============================================================');
