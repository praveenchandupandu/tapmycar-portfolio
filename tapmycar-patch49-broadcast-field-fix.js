// ============================================================================
// TapMyCar - Patch 49 (Notification System fix): Broadcast field visibility
//
// PROBLEM
//   In the Broadcast tab, text typed into the Subject / Message / recipient
//   fields is invisible. Cause: the admin theme styles bare <input>/<textarea>
//   with a DARK background, but the Patch 44/48 .bc-input rule only set
//   color:#111 (near-black). Black text on a dark field = unreadable, and the
//   placeholder text looks faint for the same reason.
//
// FIX
//   Force every Broadcast field to a light background with dark text, and
//   give the placeholder a readable grey. One CSS rule change in
//   public/admin.html, then sync to root. No JS / backend / SQL change.
//
// Properties: idempotent (safe to re-run), backs up admin.html before editing.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch49-${ts}`);

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
  if (idx === -1) errExit(label + ': anchor not found - admin.html differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 49 - Broadcast field visibility fix');
log('==================================================');

const adminPath = path.join(PUBLIC, 'admin.html');
if (!fs.existsSync(adminPath)) errExit('public/admin.html not found');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH49_FIELDFIX') !== -1) {
  skip('public/admin.html (field colors)');
} else {
  if (html.indexOf('.bc-input,.bc-textarea,.bc-select{width:100%') === -1) {
    errExit('Broadcast .bc-input CSS not found - apply Patch 44 first.');
  }
  backup(adminPath, 'public/admin.html');

  // Replace the .bc-input rule: add a forced light background + dark text,
  // and append a placeholder colour rule right after it.
  const OLD =
    '          .bc-input,.bc-textarea,.bc-select{width:100%;border:1px solid #D1D5DB;\r\n' +
    '            border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;\r\n' +
    '            box-sizing:border-box;color:#111}\r\n';

  const NEW =
    '          /* TMC_PATCH49_FIELDFIX: force light fields - the admin theme\r\n' +
    '             styles bare inputs dark, which made typed text invisible. */\r\n' +
    '          .bc-input,.bc-textarea,.bc-select{width:100%;border:1px solid #D1D5DB;\r\n' +
    '            border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;\r\n' +
    '            box-sizing:border-box;color:#111;background:#fff;-webkit-text-fill-color:#111}\r\n' +
    '          #panel-broadcast .bc-input::placeholder,\r\n' +
    '          #panel-broadcast .bc-textarea::placeholder{color:#9CA3AF;opacity:1;\r\n' +
    '            -webkit-text-fill-color:#9CA3AF}\r\n' +
    '          #panel-broadcast select.bc-select option{color:#111;background:#fff}\r\n';

  html = replaceOnce(html, OLD, NEW, 'bc-input colour fix');
  ok('Broadcast fields set to light background + dark text');

  fs.writeFileSync(adminPath, html, { encoding: 'utf8' });
  ok('public/admin.html written');
}

log('');
log('Sync to root');
const adminRoot = path.join(ROOT, 'admin.html');
backup(adminRoot, 'root-admin.html');
fs.copyFileSync(adminPath, adminRoot);
ok('Synced admin.html -> root');

log('');
log('==================================================');
log('Patch 49 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, HARD-REFRESH /admin.html (Ctrl+Shift+R).');
log('  Open Broadcast -> the Subject, Message, recipient and tag-filter');
log('  fields should now be white with clearly readable dark text, and');
log('  placeholders a soft grey.');
log('');
