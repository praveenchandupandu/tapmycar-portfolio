#!/usr/bin/env node
/**
 * TMC_PATCH_FCM_MOBILE_CLIENT
 *
 * Adds mobile push notification registration to the Capacitor app.
 *
 * What it does:
 *   1. Creates public/tmc-push-mobile.js — the push registration script.
 *      It only runs when:
 *        - inside the Capacitor app (window.tmcIsInApp === true)
 *        - the user is signed in (has tmc_session_token)
 *      The script requests notification permission, gets an FCM token
 *      from Google, and POSTs it to /api/save-push-subscription.
 *
 *   2. Adds <script src="/tmc-push-mobile.js"></script> to every HTML
 *      file in public/ that already loads tmc-platform.js. The new
 *      script is inserted RIGHT AFTER tmc-platform.js so loading order
 *      is correct (it depends on window.tmcIsInApp).
 *
 *   3. Copies each modified HTML file from public/ to the project root
 *      (per the codebase convention where both copies are served).
 *
 * Idempotent: skips files that already include tmc-push-mobile.js.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-fcm-mobile-client-' + stamp;
fs.mkdirSync(backupDir, { recursive: true });

console.log('\n=== TMC_PATCH_FCM_MOBILE_CLIENT - Mobile push registration ===\n');

// --- 1. The client script content ------------------------------------

const clientScript = `// TMC_FCM_MOBILE - Push notification registration for Capacitor app.
//
// Triggers when:
//   - window.tmcIsInApp === true (inside Capacitor; safe on web - no-op)
//   - User is signed in (has tmc_session_token in localStorage)
//
// Flow:
//   1. Request notification permission (system dialog appears)
//   2. If granted, register with FCM to get a token unique to this device
//   3. POST the token to /api/save-push-subscription (Bearer token auto-attached by app.js wrapper)
//   4. Listen for foreground notifications -> show in-app toast
//   5. Listen for notification taps -> deep link to the right page
//
// Idempotent: it's OK to load this on every page. Re-registering with
// FCM each app open is recommended practice - tokens can rotate, and our
// save endpoint upserts on fcm_token so duplicates do not pile up.

(function () {
  if (typeof window === 'undefined') return;

  // Wait until tmc-platform.js has set window.tmcIsInApp / window.tmcPlatform.
  function whenPlatformReady(cb) {
    if (typeof window.tmcIsInApp !== 'undefined') { cb(); return; }
    setTimeout(function () { whenPlatformReady(cb); }, 100);
  }

  function getSessionToken() {
    try { return localStorage.getItem('tmc_session_token'); } catch (e) { return null; }
  }

  function getCapacitor() {
    return (window.Capacitor && window.Capacitor.Plugins) || null;
  }

  async function registerPush() {
    if (!window.tmcIsInApp) return; // web -> no-op, web push uses a different path

    if (!getSessionToken()) {
      // Not signed in yet. We will be triggered again on the next page load,
      // which after sign-in lands on dashboard with a session token present.
      return;
    }

    var plugins = getCapacitor();
    if (!plugins || !plugins.PushNotifications) {
      console.warn('[tmc-push] PushNotifications plugin not available');
      return;
    }
    var Push = plugins.PushNotifications;

    // --- Listeners (must be set BEFORE register()) ---

    Push.addListener('registration', async function (tokenInfo) {
      var token = tokenInfo && tokenInfo.value;
      if (!token) { console.warn('[tmc-push] empty token'); return; }
      console.log('[tmc-push] FCM token received:', token.slice(0, 24) + '...');

      try {
        var res = await fetch('/api/save-push-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Authorization: Bearer <session_token> is auto-attached by
          // the app.js fetch wrapper (Patch 38S3).
          body: JSON.stringify({
            fcm_token: token,
            platform: window.tmcPlatform // 'android' or 'ios'
          })
        });
        var data = {};
        try { data = await res.json(); } catch (e) {}
        if (res.ok && data && data.success) {
          console.log('[tmc-push] token saved to server');
          try { localStorage.setItem('tmc_push_registered', '1'); } catch (e) {}
        } else {
          console.error('[tmc-push] save failed:', res.status, data);
        }
      } catch (e) {
        console.error('[tmc-push] save error:', e && e.message);
      }
    });

    Push.addListener('registrationError', function (err) {
      console.error('[tmc-push] registration error:', err);
    });

    Push.addListener('pushNotificationReceived', function (notification) {
      // Fires when a push arrives while the app is in FOREGROUND.
      // Android suppresses the system notification in this case, so we
      // show an in-app toast instead.
      console.log('[tmc-push] received (foreground):', notification);
      if (typeof window.showToast === 'function') {
        var msg = (notification && (notification.title || notification.body)) || 'New notification';
        try { window.showToast(msg); } catch (e) {}
      }
    });

    Push.addListener('pushNotificationActionPerformed', function (action) {
      // Fires when the user TAPS the notification (app was background/closed).
      console.log('[tmc-push] tapped:', action);
      var data = (action && action.notification && action.notification.data) || {};
      // Deep link based on type. Default: dashboard.
      var dest = '/dashboard.html';
      if (data.type === 'tow') dest = '/dashboard.html#tows';
      else if (data.type === 'billing') dest = '/billing.html';
      else if (data.type === 'scan') dest = '/dashboard.html';
      else if (data.type === 'security') dest = '/profile.html';
      else if (data.url) dest = data.url;
      try { window.location.href = dest; } catch (e) {}
    });

    // --- Permission + register ---

    try {
      var perm = await Push.requestPermissions();
      if (perm && perm.receive === 'granted') {
        await Push.register();
      } else {
        console.log('[tmc-push] permission not granted:', perm && perm.receive);
      }
    } catch (e) {
      console.error('[tmc-push] permission/register error:', e && e.message);
    }
  }

  function start() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { whenPlatformReady(registerPush); });
    } else {
      whenPlatformReady(registerPush);
    }
  }

  start();

  // Expose for manual testing in DevTools / from sign-in success handler.
  window.tmcRegisterPush = registerPush;
})();
`;

// --- 2. Write public/tmc-push-mobile.js ------------------------------

const clientPath = path.join('public', 'tmc-push-mobile.js');
if (fs.existsSync(clientPath)) {
  fs.copyFileSync(clientPath, path.join(backupDir, 'tmc-push-mobile.js.previous'));
  console.log('  ~ public/tmc-push-mobile.js already exists - overwriting (previous backed up)');
}
fs.writeFileSync(clientPath, clientScript, 'utf8');
console.log('  + public/tmc-push-mobile.js (' + clientScript.length + ' bytes)');

// --- 3. Inject <script src="/tmc-push-mobile.js"> into HTML files ----

const publicDir = 'public';
if (!fs.existsSync(publicDir)) {
  console.error('  X public/ folder not found');
  process.exit(1);
}

const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
console.log('\n  HTML files scanned: ' + htmlFiles.length);

let injected = 0;
let alreadyHad = 0;
let skipped = 0;
const modifiedFiles = [];

// Match common forms of including tmc-platform.js
// We use \r?\n to tolerate both LF and CRLF line endings.
const platformTagRegex = /(<script\s+src=["'][^"']*tmc-platform\.js["'][^>]*><\/script>)/i;
const alreadyHasPushRegex = /tmc-push-mobile\.js/;
const newTag = '<script src="/tmc-push-mobile.js"></script>';

for (const f of htmlFiles) {
  const fp = path.join(publicDir, f);
  let html;
  try { html = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }

  if (!platformTagRegex.test(html)) {
    skipped += 1;
    continue;
  }
  if (alreadyHasPushRegex.test(html)) {
    alreadyHad += 1;
    continue;
  }

  // Back up before modifying
  fs.mkdirSync(path.join(backupDir, 'public'), { recursive: true });
  fs.copyFileSync(fp, path.join(backupDir, 'public', f));

  // Insert the new script tag right AFTER the tmc-platform.js tag.
  // Function-based replace avoids $-style interpolation bugs.
  const newHtml = html.replace(platformTagRegex, function (match) {
    return match + '\n  ' + newTag;
  });

  fs.writeFileSync(fp, newHtml, 'utf8');
  modifiedFiles.push(f);
  injected += 1;
}

console.log('  + Injected into ' + injected + ' HTML files');
console.log('  ~ Already had it: ' + alreadyHad);
console.log('  - Skipped (no tmc-platform.js): ' + skipped);

// --- 4. Copy modified HTML files from public/ to project root --------

if (modifiedFiles.length > 0) {
  console.log('\n  Copying modified HTML files to project root (per codebase convention):');
  let copied = 0;
  for (const f of modifiedFiles) {
    const srcPath = path.join(publicDir, f);
    const dstPath = f;
    try {
      // Backup existing root file if present
      if (fs.existsSync(dstPath)) {
        fs.copyFileSync(dstPath, path.join(backupDir, 'root-' + f));
      }
      fs.copyFileSync(srcPath, dstPath);
      copied += 1;
    } catch (e) {
      console.error('    X failed to copy ' + f + ': ' + e.message);
    }
  }
  console.log('  + Copied ' + copied + ' files to root');
}

// --- 5. Done ---------------------------------------------------------

console.log('\n  Backup: ' + backupDir + '/');
console.log('');
console.log('Next steps:');
console.log('  npx cap sync android');
console.log('  git add -A');
console.log('  git commit -m "Phase 3: Mobile push registration (client + HTML wiring)"');
console.log('  git push');
console.log('');
console.log('Then in Android Studio:');
console.log('  1. Build > Clean Project');
console.log('  2. Build > Build Bundle(s) / APK(s) > Build APK(s)');
console.log('  3. Install on emulator/device, sign in');
console.log('  4. Accept the notification permission popup');
console.log('  5. Watch logcat for "[tmc-push] FCM token received: ..."');
console.log('');
