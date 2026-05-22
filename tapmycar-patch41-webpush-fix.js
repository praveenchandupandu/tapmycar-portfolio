// ============================================================================
// TapMyCar - Patch 41 (Notification System, STAGE 1): Fix web push
//
// WHY
//   Web push has never worked. registerPush() in app.js calls
//   pushManager.subscribe() with applicationServerKey set to a hardcoded
//   string:  'EKYvbjg84PwT28vsbESyR45_5mR7eiLG-...'
//   Two problems with that:
//     1. The key is STRUCTURALLY INVALID. Decoded, its first byte is 0x10.
//        A valid VAPID public key is an uncompressed P-256 point and MUST
//        start with 0x04. The browser rejects it -> the error you see:
//        "applicationServerKey is not valid".
//     2. Even a valid key must be passed as a Uint8Array, not a string.
//        The current code passes a string.
//   Also: sw.js points the notification icon/badge at /icons/icon-192x192.png
//   and /icons/icon-72x72.png - neither file exists (real files are
//   /icon-192.png and /icon-512.png), so notifications render without an icon.
//
// WHAT THIS PATCH DOES
//   1. public/app.js - adds a urlBase64ToUint8Array() helper and rewrites the
//      applicationServerKey line to use a NEW, VALID VAPID public key
//      (generated fresh - see the keys printed at the end of this run).
//   2. public/sw.js  - fixes the icon/badge paths to real files.
//   3. Syncs public/app.js -> root app.js and public/sw.js -> root sw.js.
//
//   It does NOT touch api/send-push.js or api/save-push-subscription.js -
//   those already read VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY from env and are
//   correct. You just need to set those env vars in Vercel (instructions
//   printed at the end).
//
// Properties: idempotent (safe to re-run), validates JS, backs up changed files.
//
// AFTER RUNNING THIS PATCH you MUST do the Vercel env-var step printed at the
// end, then redeploy. Push will not work until the env vars are set.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch41-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

// ---- The NEW, VALID VAPID keypair (generated for this patch) ---------------
// Public key goes into app.js (below). Both keys go into Vercel env vars.
const VAPID_PUBLIC  = 'BDJaBVzTHDODJtF9xeEwuaVsEb2axVw1xPkRCK1Gdv57G5iZFBY-jADC1Tx9A3rxZfVQsqyA1Uk4qYHBlNYnbyU';
const VAPID_PRIVATE = 'zTBwZCazfAjFnxAg5cHjD0JCxie2EyLMVAkADYztgtk';

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' }); // UTF-8, no BOM
}
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
// Replace exactly one occurrence. Function replacer => $ sequences are literal.
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor text not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor text appears more than once - cannot safely patch.');
  }
  return src.replace(find, function () { return replace; });
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 41 (Stage 1) - Fix web push');
log('==========================================');

// ----------------------------------------------------------------------------
// STEP 1 - public/app.js : valid key + Uint8Array conversion
// ----------------------------------------------------------------------------
log('');
log('Step 1 - public/app.js (registerPush)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = readFile(appPath);

if (appSrc.indexOf('TMC_PATCH41_WEBPUSH') !== -1) {
  skip('public/app.js push fix');
} else {
  backup(appPath, 'public/app.js');

  // 1a - insert the urlBase64ToUint8Array helper just before registerPush().
  const ANCHOR = 'async function registerPush() {';
  const HELPER =
    '// TMC_PATCH41_WEBPUSH: pushManager.subscribe() requires the VAPID key as a\n' +
    '// Uint8Array, not a string. This converts the base64url public key.\n' +
    'function urlBase64ToUint8Array(base64String) {\n' +
    '  const padding = \'=\'.repeat((4 - base64String.length % 4) % 4);\n' +
    '  const base64 = (base64String + padding).replace(/-/g, \'+\').replace(/_/g, \'/\');\n' +
    '  const raw = atob(base64);\n' +
    '  const output = new Uint8Array(raw.length);\n' +
    '  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);\n' +
    '  return output;\n' +
    '}\n\n' +
    ANCHOR;
  appSrc = replaceOnce(appSrc, ANCHOR, HELPER, 'app.js helper insert');
  ok('Added urlBase64ToUint8Array() helper');

  // 1b - replace the broken applicationServerKey line.
  const KEY_OLD =
    "applicationServerKey: 'EKYvbjg84PwT28vsbESyR45_5mR7eiLG-NCqFPz0kAsZUCTA7see54fuytLQ6S_NCxheRYPO93OhqM3HK3HNpxg'";
  const KEY_NEW =
    "applicationServerKey: urlBase64ToUint8Array('" + VAPID_PUBLIC + "')";
  appSrc = replaceOnce(appSrc, KEY_OLD, KEY_NEW, 'app.js VAPID key');
  ok('Replaced invalid VAPID key with the new valid key');

  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/sw.js : fix notification icon/badge paths
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/sw.js (notification icons)');

const swPath = path.join(PUBLIC, 'sw.js');
let swSrc = readFile(swPath);

if (swSrc.indexOf("/icons/icon-192x192.png") === -1 &&
    swSrc.indexOf("/icons/icon-72x72.png") === -1) {
  skip('public/sw.js icon paths');
} else {
  backup(swPath, 'public/sw.js');
  if (swSrc.indexOf("'/icons/icon-192x192.png'") !== -1) {
    swSrc = replaceOnce(swSrc, "'/icons/icon-192x192.png'", "'/icon-192.png'", 'sw.js icon');
  }
  if (swSrc.indexOf("'/icons/icon-72x72.png'") !== -1) {
    swSrc = replaceOnce(swSrc, "'/icons/icon-72x72.png'", "'/icon-192.png'", 'sw.js badge');
  }
  writeFile(swPath, swSrc);
  checkJs(swPath, 'public/sw.js');
  ok('Fixed notification icon + badge paths to real files');
}

// ----------------------------------------------------------------------------
// STEP 3 - sync public/ -> root copies
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync public/ files to root');

[['app.js', appPath], ['sw.js', swPath]].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  const rootCopy = path.join(ROOT, name);
  if (fs.existsSync(rootCopy)) {
    backup(rootCopy, 'root-' + name);
    fs.copyFileSync(src, rootCopy);
    ok('Synced ' + name + ' -> root');
  } else {
    log('  \u00b7 no root copy of ' + name + ' - skipped');
  }
});

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('==========================================');
log('Patch 41 (Stage 1) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  REQUIRED NEXT STEP - set 3 environment variables in Vercel');
log('  ---------------------------------------------------------------');
log('  Vercel dashboard -> your project -> Settings -> Environment');
log('  Variables. Add (or update) these three, for Production:');
log('');
log('   VAPID_PUBLIC_KEY   = ' + VAPID_PUBLIC);
log('   VAPID_PRIVATE_KEY  = ' + VAPID_PRIVATE);
log('   VAPID_EMAIL        = mailto:support@tapmycar.io');
log('');
log('  The VAPID_PUBLIC_KEY above MUST match the key now in app.js, and');
log('  api/send-push.js reads all three. If any are missing, push fails.');
log('');
log('  Then:  git add -A  &&  git commit -m "Patch 41: fix web push"  &&  git push');
log('  Wait ~60s for Vercel, then test in a fresh incognito window:');
log('   1. Sign in, open /dashboard.html  (registerPush runs there)');
log('   2. Allow the notification permission prompt');
log('   3. In the browser console, with no errors, push is registered.');
log('   4. To test delivery: POST /api/send-push with {"user_id":"<your');
log('      tmc_token>","title":"Test","body":"Hello"} - you should get a');
log('      system notification.');
log('');
