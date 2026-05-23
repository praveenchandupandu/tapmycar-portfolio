// ============================================================================
// TapMyCar - Patch 51 (Notification System change): Remove scan throttle
//
// CHANGE REQUESTED
//   Patch 50 added a 3-hour cooldown so a tag owner is notified at most once
//   per tag per 3 hours. Praveen wants EVERY scan to notify - no cooldown.
//
// WHAT THIS PATCH DOES
//   Edits api/scan-notify.js: sets the cooldown to 0. With COOLDOWN_MS = 0
//   the throttle check "(now - last) < 0" is always false, so the endpoint
//   never skips - every scan of an active tag notifies the owner.
//
//   scan_notify_state is still updated (it keeps a lifetime notify_count
//   and a last_notified_at timestamp, which stays useful for stats), it
//   just no longer blocks anything.
//
//   No SQL change. No other file changes.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch51-${ts}`);

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
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
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
log('TapMyCar Patch 51 - Remove scan-notify throttle');
log('===============================================');

const epPath = path.join(API, 'scan-notify.js');
if (!fs.existsSync(epPath)) errExit('api/scan-notify.js not found - run Patch 50 first.');

let src = fs.readFileSync(epPath, 'utf8');

if (src.indexOf('TMC_PATCH51_NOTHROTTLE') !== -1) {
  skip('api/scan-notify.js');
} else {
  if (src.indexOf('const COOLDOWN_MS = 3 * 60 * 60 * 1000;') === -1) {
    errExit('COOLDOWN_MS line not found - scan-notify.js differs from expected.');
  }
  backup(epPath, 'api/scan-notify.js');

  src = replaceOnce(
    src,
    'const COOLDOWN_MS = 3 * 60 * 60 * 1000;  // 3 hours between alerts for one tag',
    'const COOLDOWN_MS = 0;  // TMC_PATCH51_NOTHROTTLE: 0 = notify on every scan',
    'COOLDOWN_MS'
  );

  fs.writeFileSync(epPath, src, { encoding: 'utf8' });
  checkJs(epPath, 'api/scan-notify.js');
  ok('Throttle removed - every scan now notifies the owner');
}

log('');
log('===============================================');
log('Patch 51 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. Then scan TMC-44HSQ5 - you should get a');
log('  notification EVERY time now, with no cooldown. No need to clear');
log('  scan_notify_state between tests anymore.');
log('');
log('  (If you ever want a cooldown back, it is just this one number -');
log('  e.g. 60 * 1000 for a 1-minute window.)');
log('');
