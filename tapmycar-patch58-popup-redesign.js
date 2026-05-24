// ============================================================================
// TapMyCar - Patch 58: Redesign the in-app announcement popup (Option 2)
//
// PREREQUISITE
//   Patch 57 deployed (the popup exists in app.js).
//
// CHANGE REQUESTED
//   Replace the popup look with the chosen "Option 2 - minimal" design:
//     - no icon,
//     - "TapMyCar Alert" heading in the brand orange (#FF6B00),
//     - a thin centered divider line,
//     - announcement title + message centered,
//     - a single centered orange "Close" button,
//     - no "View Inbox" button.
//
// WHAT THIS PATCH DOES
//   Replaces the showAnnouncementPopup() function body in public/app.js with
//   the redesigned card. The fetch / get-announcement / seen-announcement
//   logic and "show once per user" behaviour are unchanged - only the
//   markup and button handlers change (View button removed -> its redirect
//   handler removed too).
//   Syncs app.js -> root.
//
//   No SQL change. No backend change. No admin.html change.
//
// Properties: idempotent (safe to re-run), validates JS, backs up app.js.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch58-${ts}`);

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
log('TapMyCar Patch 58 - Redesign announcement popup (Option 2)');
log('==========================================================');

const appPath = path.join(PUBLIC, 'app.js');
if (!fs.existsSync(appPath)) errExit('public/app.js not found');
let src = fs.readFileSync(appPath, 'utf8');

if (src.indexOf('TMC_PATCH58_POPUP_REDESIGN') !== -1) {
  skip('public/app.js');
} else {
  const FN_START = '  function showAnnouncementPopup(ann, userId) {';
  const FN_END_ANCHOR = '  function checkAnnouncement() {';
  const i1 = src.indexOf(FN_START);
  const i2 = src.indexOf(FN_END_ANCHOR);
  if (i1 === -1 || i2 === -1 || i2 < i1) {
    errExit('Could not bound showAnnouncementPopup - apply Patch 57 first.');
  }
  backup(appPath, 'public/app.js');

  const NEW_FN = [
    '  function showAnnouncementPopup(ann, userId) {',
    '    // TMC_PATCH58_POPUP_REDESIGN - Option 2: minimal, orange title.',
    '    if (document.getElementById("tmc-ann-overlay")) return;',
    '',
    '    var overlay = document.createElement("div");',
    '    overlay.id = "tmc-ann-overlay";',
    '    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;" +',
    '      "background:rgba(17,17,17,.45);display:flex;align-items:center;" +',
    '      "justify-content:center;padding:24px;font-family:Inter,-apple-system," +',
    '      "Segoe UI,Roboto,sans-serif";',
    '',
    '    var bodyHtml = tmcEscAnn(ann.body).replace(/\\r?\\n/g, "<br>");',
    '    overlay.innerHTML =',
    '      \'<div style="background:#fff;max-width:340px;width:100%;\' +',
    '        \'border-radius:18px;box-shadow:0 14px 44px rgba(0,0,0,.28);\' +',
    '        \'padding:30px 28px 26px;text-align:center">\' +',
    '          \'<div style="font-size:19px;font-weight:800;color:#FF6B00;\' +',
    '            \'margin-bottom:4px">TapMyCar Alert</div>\' +',
    '          \'<div style="width:34px;height:2px;background:#E5E7EB;\' +',
    '            \'margin:13px auto 17px"></div>\' +',
    '          \'<div style="font-size:15px;font-weight:700;color:#111;\' +',
    '            \'margin-bottom:8px">\' + tmcEscAnn(ann.title) + \'</div>\' +',
    '          \'<div style="font-size:14px;line-height:1.65;color:#6B7280;\' +',
    '            \'margin-bottom:24px">\' + bodyHtml + \'</div>\' +',
    '          \'<button id="tmc-ann-close" style="padding:12px 36px;border:none;\' +',
    '            \'border-radius:9px;background:#FF6B00;color:#fff;font-size:14px;\' +',
    '            \'font-weight:700;cursor:pointer;font-family:inherit">Close</button>\' +',
    '      \'</div>\';',
    '',
    '    document.body.appendChild(overlay);',
    '',
    '    function markSeen() {',
    '      try {',
    '        fetch("/api/seen-announcement", {',
    '          method: "POST",',
    '          headers: { "Content-Type": "application/json" },',
    '          body: JSON.stringify({ user_id: userId, announcement_id: ann.id })',
    '        }).catch(function () {});',
    '      } catch (e) {}',
    '    }',
    '    function dismiss() {',
    '      markSeen();',
    '      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);',
    '    }',
    '',
    '    document.getElementById("tmc-ann-close").onclick = dismiss;',
    '    overlay.addEventListener("click", function (e) {',
    '      if (e.target === overlay) dismiss();',
    '    });',
    '  }',
    '',
    ''
  ].join('\n');

  src = src.slice(0, i1) + NEW_FN + src.slice(i2);
  fs.writeFileSync(appPath, src, { encoding: 'utf8' });
  checkJs(appPath, 'public/app.js');
  ok('Popup redesigned - Option 2, orange "TapMyCar Alert" title');
}

log('');
log('Sync to root');
const appRoot = path.join(ROOT, 'app.js');
if (fs.existsSync(appRoot)) {
  backup(appRoot, 'root-app.js');
  fs.copyFileSync(appPath, appRoot);
  ok('Synced app.js -> root');
}

log('');
log('==========================================================');
log('Patch 58 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Before / alongside this, retire the old test announcement in the');
log('  Supabase SQL editor so it stops showing:');
log("    update announcements set active = false where title = 'Popup test 2';");
log('');
log('  Commit + push, wait ~60s, hard-refresh. Then send a NEW broadcast');
log('  with "Also show as in-app popup" ticked and open /dashboard.html as');
log('  a normal user - the popup shows the new minimal design: orange');
log('  "TapMyCar Alert" title, divider, message, single orange Close.');
log('');
log('  (A NEW announcement is needed - dismissed ones do not reappear.)');
log('');
