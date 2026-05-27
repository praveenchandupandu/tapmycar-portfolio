/* ============================================================================
 * TapMyCar  Patch 39b  rename admin page to a secret URL
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch39b-rename-admin.js
 *
 * Renames the admin panel from the guessable public/admin.html to a secret
 * filename, so casual probing of /admin.html stops finding it.
 *
 *   public/admin.html  ->  public/cmshaveaccesstouser2026-npmevy.html
 *   New admin URL:  https://tapmycar.io/cmshaveaccesstouser2026-npmevy.html
 *
 * IMPORTANT  this is only a minor "harder to stumble onto" layer. The real
 * lock is ADMIN_SECRET_KEY. The secret URL still leaks into browser history
 * and server logs, so it is NOT a substitute for a strong rotated key.
 *
 * Two supporting edits so nothing breaks AND the secret name never lands in
 * a public file:
 *   1. The renamed admin page sets  window.__tmcNoChat = true  in its <head>.
 *   2. app.js stops checking the URL for the word "admin" (which would no
 *      longer match) and instead checks that flag. This keeps the customer
 *      chat bubble off the admin page WITHOUT writing the secret filename
 *      into app.js — app.js is downloaded by every public visitor, so the
 *      secret name must never appear in it.
 *
 * NO redirect is added from the old /admin.html — a redirect would hand the
 * secret URL to anyone who hits the old path. Old URL will simply 404.
 *
 * SAFE TO RE-RUN: detects the already-renamed state and skips.
 * Run Patch 39 (admin key hardening) BEFORE this. Both, plus this, can be
 * committed together in one push.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OLD = path.join('public', 'admin.html');
const NEW = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const APP = path.join('public', 'app.js');
const MARKER = 'TMC_PATCH39B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = path.join('backup-patch39b-' + STAMP, 'public');

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ---- the flag injected into the admin page <head> ---------------------- */
const FLAG = [
  "<!-- TMC_PATCH39B: mark this as the admin page WITHOUT naming it. app.js",
  "     reads this flag to keep the customer chat bubble off this page. The",
  "     secret filename is deliberately never written into app.js (a public",
  "     file). -->",
  "<script>window.__tmcNoChat = true;</script>"
].join('\r\n');

const FLAG_FIND = "</head>\r\n<body>";
const FLAG_REPLACE = FLAG + "\r\n</head>\r\n<body>";

/* ---- app.js: flag check instead of URL-name check ---------------------- */
const APP_FIND = "  if (window.location.pathname.includes('admin')) return;";
const APP_REPLACE =
  "  /* TMC_PATCH39B: the admin page sets window.__tmcNoChat. We check that\n" +
  "     flag instead of the URL so the admin page can have a secret name\n" +
  "     without that name ever appearing in this public file. */\n" +
  "  if (window.__tmcNoChat) return;";

/* ========================================================================
 * DRIVER
 * ======================================================================*/
log('\nTapMyCar  Patch 39b  rename admin page to a secret URL');
log('Backup -> ' + BACKUP_DIR + '\n');

/* ---- detect already-applied state -------------------------------------- */
const newExists = fs.existsSync(NEW);
const oldExists = fs.existsSync(OLD);
let appText = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : null;
const appDone = appText !== null && appText.indexOf(MARKER) !== -1;

if (newExists && !oldExists && appDone) {
  log('Already applied  admin page is renamed and app.js is patched. Nothing to do.\n');
  process.exit(0);
}

/* ---- sanity: must have exactly the expected starting state ------------- */
if (!oldExists && !newExists) {
  fail('neither ' + OLD + ' nor ' + NEW + ' exists. Run from the project root.');
}
if (newExists && oldExists) {
  fail('BOTH ' + OLD + ' and ' + NEW + ' exist. Resolve this by hand before '
    + 're-running (delete whichever is stale). Nothing was written.');
}
if (appText === null) {
  fail('expected file not found: ' + APP);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ======================================================================
 * STEP 1  rename admin.html -> secret name, inject the flag
 * ====================================================================*/
if (oldExists) {
  let html = fs.readFileSync(OLD, 'utf8');
  fs.copyFileSync(OLD, path.join(BACKUP_DIR, 'admin.html'));   /* backup */

  if (html.indexOf('window.__tmcNoChat') === -1) {
    const first = html.indexOf(FLAG_FIND);
    if (first === -1) {
      fail('could not find the </head><body> insertion point in admin.html. '
        + 'Nothing was written.');
    }
    if (html.indexOf(FLAG_FIND, first + 1) !== -1) {
      fail('the </head><body> insertion point is ambiguous in admin.html. '
        + 'Nothing was written.');
    }
    html = html.replace(FLAG_FIND, function () { return FLAG_REPLACE; });
    log('   - admin page: __tmcNoChat flag injected');
  } else {
    log('   - admin page: __tmcNoChat flag already present');
  }

  fs.writeFileSync(NEW, html, 'utf8');   /* write secret-named file */
  fs.unlinkSync(OLD);                    /* remove old admin.html */
  log('   - renamed: public/admin.html -> public/' + path.basename(NEW));
} else {
  log('   - admin page already at secret name (skipping rename)');
}

/* ======================================================================
 * STEP 2  app.js  flag check instead of URL check
 * ====================================================================*/
if (!appDone) {
  fs.copyFileSync(APP, path.join(BACKUP_DIR, 'app.js'));   /* backup */
  const appOriginal = appText;

  const first = appText.indexOf(APP_FIND);
  if (first === -1) {
    fail('could not find the chat-bubble admin check in app.js. '
      + 'app.js was NOT modified (the admin page rename above DID happen  '
      + 'if you abort now, fix app.js by hand or restore from backup).');
  }
  if (appText.indexOf(APP_FIND, first + 1) !== -1) {
    fail('the chat-bubble admin check appears more than once in app.js. '
      + 'Aborting that edit.');
  }
  appText = appText.replace(APP_FIND, function () { return APP_REPLACE; })
    + '\n/* ' + MARKER + ' applied */\n';

  fs.writeFileSync(APP, appText, 'utf8');
  try {
    execSync('node --check "' + APP + '"', { stdio: 'pipe' });
    log('   - app.js: chat-bubble check now uses __tmcNoChat flag');
    log('   - node --check: OK');
  } catch (e) {
    fs.writeFileSync(APP, appOriginal, 'utf8');
    fail('node --check FAILED for app.js  it was restored to its original.\n'
      + String(e.stderr || e.message));
  }
} else {
  log('   - app.js already patched (skipping)');
}

log('\nDone.\n');
log('Your admin panel is now at:');
log('   https://tapmycar.io/cmshaveaccesstouser2026-npmevy.html');
log('Bookmark it. The old /admin.html will 404 after deploy.\n');
log('NEXT STEPS:');
log('  1. git add -A      (this stages the rename: old file deleted, new added)');
log('  2. git commit -m "Patch 39 + 39b: admin key hardening + secret admin URL"');
log('  3. git push        (wait ~60s for Vercel)');
log('  4. Visit the new URL  it should load the admin panel.');
log('     Visit /admin.html  it should 404. That is correct.\n');
