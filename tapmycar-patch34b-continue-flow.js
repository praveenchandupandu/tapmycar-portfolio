// ============================================================================
// TapMyCar - Patch 34b: Sign-in / Register continue-flow
//
// Goal: a user who scans an unclaimed tag, clicks "Activate The Tag", picks
// "I'm already a TapMyCar user", and signs in should be RETURNED to the
// tag page (where they can finish activating). Currently they land on
// /dashboard.html and have to scan the tag again.
//
// Touches three files:
//
//   1. public/contact.html — the identity-check "I'm a user" card. Replace
//      href="/signin.html" with href="/signin.html?continue=/tag/{token}"
//      so signin knows where to return. Done at runtime since the token is
//      dynamic.
//
//   2. public/signin.html — read ?continue=URL after successful OTP. If
//      present AND safe (relative path starting with "/", no protocol-
//      relative double-slash, no "://"), redirect there instead of
//      /dashboard.html.
//
//   3. public/register.html — same continue handling (for future use; the
//      current contact-html "I'm new here" stays inline, but register has
//      an outside entry point too).
//
// Safety: continue URLs are validated. Only same-origin paths starting
// with "/" but NOT "//" or containing "://" are allowed. Otherwise
// fall through to /dashboard.html.
//
// Properties: idempotent, uses safeReplace.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34b-${ts}`);

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
log('TapMyCar Patch 34b \u2014 signin/register continue-flow');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34B_CONTINUE';

// ===========================================================================
// 34b.1  contact.html — make the "I'm a user" card carry the token through
// ===========================================================================

log('34b.1  contact.html: pass current token to signin as continue URL');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('contact.html');
  } else {
    backup(file);

    // The "I'm already a TapMyCar user" card currently has href="/signin.html".
    // Change to call a new function that builds the URL with ?continue=.
    const oldCard = `<a href="/signin.html" class="p34a-identity-card">`;
    const newCard = `<a href="javascript:void(0)" onclick="_p34bGoToSignin()" class="p34a-identity-card">`;

    let updated = safeReplace(content, oldCard, newCard);
    if (!updated) errExit('contact.html: identity-card anchor not found');

    // Insert a tiny helper after proceedFromWelcome (which Patch 34a added).
    const fnAnchor = `function proceedFromWelcome() {`;
    const fnInsert = `/* ${MARKER}: build /signin.html?continue=/tag/{token} so user is returned
   here after signin. window.location.pathname already includes /tag/{token}
   for this page (per vercel.json rewrite). */
function _p34bGoToSignin() {
  try {
    var cont = window.location.pathname; /* e.g. "/tag/TMC-XXXXXX" */
    if (cont && cont.indexOf('/') === 0 && cont.indexOf('//') !== 0 && cont.indexOf('://') === -1) {
      window.location.href = '/signin.html?continue=' + encodeURIComponent(cont);
      return;
    }
  } catch (e) {}
  window.location.href = '/signin.html';
}

function proceedFromWelcome() {`;

    updated = safeReplace(updated, fnAnchor, fnInsert);
    if (!updated) errExit('contact.html: proceedFromWelcome anchor not found for _p34bGoToSignin insert');

    writeFile(file, updated);
    ok('contact.html: signin card now passes ?continue=');
  }
}

// ===========================================================================
// 34b.2  signin.html — read ?continue= and redirect there after auth
// ===========================================================================

log('');
log('34b.2  signin.html: honor ?continue= after successful signin');
{
  const file = path.join(PUBLIC, 'signin.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('signin.html');
  } else {
    backup(file);

    const oldRedirect = `      saveSession(data.token, data.phone || '', data.name || '');
      localStorage.setItem('tmc_email', email);
      window.location.href = '/dashboard.html';`;

    const newRedirect = `      saveSession(data.token, data.phone || '', data.name || '');
      localStorage.setItem('tmc_email', email);
      /* ${MARKER}: honor ?continue= if present and safe (relative path) */
      var _p34bDest = '/dashboard.html';
      try {
        var _p34bUrl = new URL(window.location.href);
        var _p34bCont = _p34bUrl.searchParams.get('continue');
        if (_p34bCont && _p34bCont.indexOf('/') === 0 && _p34bCont.indexOf('//') !== 0 && _p34bCont.indexOf('://') === -1) {
          _p34bDest = _p34bCont;
        }
      } catch (e) {}
      window.location.href = _p34bDest;`;

    const updated = safeReplace(content, oldRedirect, newRedirect);
    if (!updated) errExit('signin.html: post-auth redirect anchor not found');

    writeFile(file, updated);
    ok('signin.html: honors safe ?continue=');
  }
}

// ===========================================================================
// 34b.3  register.html — same continue-flow handling
// ===========================================================================

log('');
log('34b.3  register.html: honor ?continue= after successful registration');
{
  const file = path.join(PUBLIC, 'register.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('register.html');
  } else {
    backup(file);

    // Register has 2 redirect branches: gift-code -> /welcome.html, else
    // -> /dashboard.html. We honor continue only on the no-gift branch
    // (gift redemption flow must go through /welcome.html).
    const oldBranch = `      if (giftCode) {
        // Defer redemption to /welcome.html (avoids race conditions during signup)
        localStorage.setItem('tmc_pending_code', giftCode);
        window.location.href = '/welcome.html';
      } else {
        window.location.href = '/dashboard.html';
      }`;

    const newBranch = `      if (giftCode) {
        // Defer redemption to /welcome.html (avoids race conditions during signup)
        localStorage.setItem('tmc_pending_code', giftCode);
        window.location.href = '/welcome.html';
      } else {
        /* ${MARKER}: honor ?continue= if present and safe */
        var _p34bDest = '/dashboard.html';
        try {
          var _p34bUrl = new URL(window.location.href);
          var _p34bCont = _p34bUrl.searchParams.get('continue');
          if (_p34bCont && _p34bCont.indexOf('/') === 0 && _p34bCont.indexOf('//') !== 0 && _p34bCont.indexOf('://') === -1) {
            _p34bDest = _p34bCont;
          }
        } catch (e) {}
        window.location.href = _p34bDest;
      }`;

    const updated = safeReplace(content, oldBranch, newBranch);
    if (!updated) errExit('register.html: post-auth redirect anchor not found');

    writeFile(file, updated);
    ok('register.html: honors safe ?continue=');
  }
}

log('');
log('==============================================================');
log('Patch 34b complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34b: signin/register continue-flow"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test plan:');
log('  1. In FRESH incognito (not signed in), scan an unclaimed tag.');
log('     Click "Activate The Tag" \u2192 see identity screen.');
log('     Click "I am already a TapMyCar user".');
log('     URL should be: /signin.html?continue=%2Ftag%2FTMC-XXXXXX');
log('  2. Enter your email \u2192 get OTP \u2192 enter OTP.');
log('  3. After signin, browser should return to /tag/TMC-XXXXXX');
log('     (NOT /dashboard.html).');
log('  4. The welcome screen for that tag should now show "Activate The Tag"');
log('     button \u2014 click it. Since you are now signed in, it skips identity');
log('     and goes to verify-existing.');
log('  5. Sanity check: open /signin.html WITHOUT ?continue= \u2192 sign in \u2192');
log('     should still go to /dashboard.html. (Existing behavior preserved.)');
log('  6. Security check: try /signin.html?continue=https://evil.com \u2192 after');
log('     signin should go to /dashboard.html, not the malicious URL.');
log('==============================================================');
