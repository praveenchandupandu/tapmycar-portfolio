// ============================================================================
// TapMyCar - Patch 52 (cleanup): Service worker fetch handler + icon paths
//
// TWO FIXES in public/sw.js:
//
//   1. The "sw.js:16 Failed to fetch" console noise.
//      The fetch handler was:  e.respondWith(fetch(e.request));
//      When any request is cancelled / blocked / network-blips, that bare
//      fetch rejects with no .catch(), so the browser logs a red
//      "Uncaught (in promise) TypeError: Failed to fetch". Harmless, but
//      noisy. New handler adds a .catch() so a failed request fails quietly.
//      It also skips non-GET requests (POST API calls etc. should pass
//      straight through untouched).
//
//   2. Notification icon paths. Lines 24-25 pointed at /icons/icon-192x192.png
//      and /icons/icon-72x72.png - neither file exists, so push notifications
//      render with a blank icon. Corrected to the real files: /icon-192.png.
//      (Patch 41 intended this fix; this sw.js still had the old paths, so
//      it is re-applied here to be sure.)
//
//   sw.js currently starts with a UTF-8 BOM; this patch rewrites it WITHOUT
//   a BOM, per project convention.
//
//   No SQL change. No other files.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file,
//   then syncs public/sw.js -> root sw.js.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch52-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
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
log('TapMyCar Patch 52 - Service worker cleanup');
log('==========================================');

const swPath = path.join(PUBLIC, 'sw.js');
if (!fs.existsSync(swPath)) errExit('public/sw.js not found');

const current = fs.readFileSync(swPath, 'utf8');
if (current.indexOf('TMC_PATCH52_SW') !== -1) {
  skip('public/sw.js');
} else {
  backup(swPath, 'public/sw.js');

  // Full clean rewrite of sw.js (it is a small, self-contained file).
  const NEW_SW = [
    "// TMC_PATCH52_SW - quiet fetch handler + correct notification icons",
    "const CACHE_NAME = 'tapmycar-v7';",
    "",
    "self.addEventListener('install', e => {",
    "  self.skipWaiting();",
    "});",
    "",
    "self.addEventListener('activate', e => {",
    "  e.waitUntil(",
    "    caches.keys().then(keys =>",
    "      Promise.all(keys.map(k => caches.delete(k)))",
    "    ).then(() => self.clients.claim())",
    "  );",
    "});",
    "",
    "// Pass-through fetch. Non-GET requests are left entirely alone.",
    "// The .catch() stops a cancelled / blocked / failed request from",
    "// logging an 'Uncaught (in promise) Failed to fetch' in the console.",
    "self.addEventListener('fetch', e => {",
    "  if (e.request.method !== 'GET') return;",
    "  e.respondWith(",
    "    fetch(e.request).catch(() => Response.error())",
    "  );",
    "});",
    "",
    "self.addEventListener('push', function(event) {",
    "  const data = event.data ? event.data.json() : {};",
    "  const title = data.title || 'TapMyCar';",
    "  const options = {",
    "    body: data.body || 'Someone scanned your tag!',",
    "    icon: '/icon-192.png',",
    "    badge: '/icon-192.png',",
    "    data: { url: data.url || '/activity.html' },",
    "    vibrate: [200, 100, 200]",
    "  };",
    "  event.waitUntil(self.registration.showNotification(title, options));",
    "});",
    "",
    "self.addEventListener('notificationclick', function(event) {",
    "  event.notification.close();",
    "  const url = event.notification.data.url || '/activity.html';",
    "  event.waitUntil(clients.openWindow(url));",
    "});",
    ""
  ].join('\n');

  fs.writeFileSync(swPath, NEW_SW, { encoding: 'utf8' }); // UTF-8, no BOM
  checkJs(swPath, 'public/sw.js');
  ok('public/sw.js rewritten - quiet fetch handler + real icon paths, BOM removed');
}

log('');
log('Sync to root');
const swRoot = path.join(ROOT, 'sw.js');
if (fs.existsSync(swRoot)) {
  backup(swRoot, 'root-sw.js');
  fs.copyFileSync(swPath, swRoot);
  ok('Synced sw.js -> root');
} else {
  log('  \u00b7 no root sw.js - skipped');
}

log('');
log('==========================================');
log('Patch 52 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. The service worker is versioned v7, so');
log('  browsers pick up the new sw.js automatically on next visit.');
log('');
log('  TEST:');
log('   1. Open any page on www.tapmycar.io, press F12 -> Console.');
log('   2. Browse / reload a couple of times. The red "sw.js Failed to');
log('      fetch" line should no longer appear.');
log('   3. Trigger a scan notification (scan TMC-44HSQ5) - the popup now');
log('      shows the TapMyCar icon instead of a blank one.');
log('   (If you still see an old sw.js, hard-refresh once - Ctrl+Shift+R -');
log('    or in F12 -> Application -> Service Workers click Unregister, then');
log('    reload; the v7 worker installs fresh.)');
log('');
