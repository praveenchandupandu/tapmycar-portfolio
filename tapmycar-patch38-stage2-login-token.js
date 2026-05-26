// ============================================================================
// TapMyCar - Patch 38 (Stage 2 of 5): Login issues signed session tokens
//
// SECURITY CONTEXT (recap)
// We are replacing "trust a raw user-id" with signed session tokens, so a
// hacker cannot impersonate another user by swapping an id. Built in 5
// backward-compatible stages so NO existing user is ever logged out.
//
//   Stage 1 (done): created api/_auth.js (sign/verify/resolveUser).
//   Stage 2 (THIS): login also returns a signed token.
//   Stage 3: the frontend stores + sends the signed token.
//   Stage 4: the ~10 sensitive endpoints verify the token.
//   Stage 5 (later): drop the legacy raw-id fallback.
//
// WHAT THIS STAGE DOES
// verify-otp.js has two login success returns (phone path + email path).
// Both currently return:  { token: <raw user id>, ... }
// This patch makes both ALSO return:  session_token: <signed token>
// The existing `token` field is LEFT UNTOUCHED. So:
//   - anything still reading `token` keeps working (nothing breaks)
//   - the new `session_token` is there for Stage 3 to start using
//
// RISK LEVEL: very low. We only ADD a field to the login response. No
// existing field changes, no existing behaviour changes. If JWT_SECRET
// is somehow not set, signing is wrapped in try/catch and login still
// succeeds with the old `token` exactly as before (fails safe).
//
// PREREQUISITE: Stage 1 deployed AND the JWT_SECRET env var set in Vercel.
//
// Idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch38s2-${ts}`);

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
log('TapMyCar Patch 38 \u2014 Stage 2 of 5: login issues signed tokens');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH38S2_LOGIN_TOKEN';

const file = path.join(API, 'verify-otp.js');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('verify-otp.js (already patched)');
  process.exit(0);
}

/* sanity: Stage 1 must exist */
if (!fs.existsSync(path.join(API, '_auth.js'))) {
  errExit('api/_auth.js not found \u2014 deploy Patch 38 Stage 1 first');
}

backup(file);
let updated = content;

/* 1. add the _auth require at the top, after the first require line */
const firstRequire = updated.match(/^.*require\(['"][^'"]+['"]\).*$/m);
if (!firstRequire) errExit('verify-otp.js: no require() line found to anchor import');
const importLine = firstRequire[0];
updated = updated.replace(importLine, () =>
  importLine + '\n/* ' + MARKER + ' */\nconst { signSession } = require(\'./_auth\');');
ok('added _auth import');

/* helper inserted once: a safe signer that never throws */
const safeSignerFn = `
/* ${MARKER}: sign a session token, never throw. If JWT_SECRET is missing
   or signing fails, return null and login still succeeds with the legacy
   token field (fail-safe \u2014 no one is locked out). */
function _tmcSafeSign(uid) {
  try { return signSession(uid); } catch (e) {
    console.error('${MARKER}: token signing failed (non-fatal):', e && e.message);
    return null;
  }
}
`;

/* place the helper right before the handler export, or before the first
   "module.exports" / "async function handler". Anchor on a stable point:
   just after the _auth import we added. */
updated = updated.replace(
  "const { signSession } = require('./_auth');",
  "const { signSession } = require('./_auth');\n" + safeSignerFn
);
ok('added _tmcSafeSign helper');

/* 2. phone-path login return (line ~146) */
const oldPhone = `    return res.json({ token: user.id, name: user.name, phone: user.phone });`;
const newPhone = `    /* ${MARKER}: also issue a signed session token (legacy token kept) */
    return res.json({ token: user.id, session_token: _tmcSafeSign(user.id), name: user.name, phone: user.phone });`;
let r = safeReplace(updated, oldPhone, newPhone);
if (!r) errExit('verify-otp.js: phone-path login return not found');
updated = r;
ok('phone-path login: session_token added');

/* 3. email-path login return (line ~304) */
const oldEmail = `    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      isNewUser
    });`;
const newEmail = `    /* ${MARKER}: also issue a signed session token (legacy token kept) */
    return res.json({
      token: user.id,
      session_token: _tmcSafeSign(user.id),
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      isNewUser
    });`;
r = safeReplace(updated, oldEmail, newEmail);
if (!r) errExit('verify-otp.js: email-path login return not found');
updated = r;
ok('email-path login: session_token added');

writeFile(file, updated);

try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
  ok('verify-otp.js JS valid');
} catch (e) {
  errExit('verify-otp.js JS error: ' + e.stderr.toString());
}

log('');
log('==============================================================');
log('Patch 38 Stage 2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('PREREQUISITE CHECK before deploying:');
log('  - Patch 38 Stage 1 must already be deployed (api/_auth.js live)');
log('  - JWT_SECRET env var must be set in Vercel');
log('  If JWT_SECRET is missing, login STILL works (fail-safe) \u2014 it just');
log('  will not include a session_token until the var is set.');
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 38 Stage 2: login issues signed session tokens"');
log('  git push');
log('');
log('Test (nothing user-visible should change):');
log('  1. Log in normally (phone OTP or email OTP). Login works as before.');
log('  2. To confirm the new token is issued: open DevTools -> Network,');
log('     log in, click the verify-otp request -> Response. You should see');
log('     BOTH "token" (the old field) AND "session_token" (new, a long');
log('     string with two dots-separated parts).');
log('  3. If session_token is null -> JWT_SECRET is not set in Vercel.');
log('     Set it and redeploy. Login still works either way.');
log('');
log('No existing behaviour changed. The frontend does not USE session_token');
log('yet \u2014 that is Stage 3. This stage just makes login hand it out.');
log('==============================================================');
