// ============================================================================
// TapMyCar - Patch 57 (Stage 6-b): In-app announcement popup + admin checkbox
//
// PREREQUISITE
//   Patch 56 deployed: announcements + announcement_seen tables, and the
//   send-broadcast / get-announcement / seen-announcement endpoints.
//
// WHAT THIS PATCH DOES
//   1. public/app.js  - adds the in-app announcement POPUP. On every page
//      that loads app.js, for a logged-in user (tmc_token present), it asks
//      /api/get-announcement; if there is an announcement the user has not
//      dismissed, it shows a centered card (title + message + Close / View
//      Activity buttons), exactly like the reference screenshot. Dismissing
//      calls /api/seen-announcement so it never shows again for that user.
//
//   2. public/admin.html  - adds an "Also show as in-app popup" CHECKBOX to
//      the Broadcast tab (under the channel picker), and includes its value
//      as also_in_app in the bcSend() payload. Ticking it makes that
//      broadcast also appear as the in-app popup.
//
//   3. Syncs app.js + admin.html to root.
//
//   No SQL change. No backend change. No vercel.json change.
//
// Properties: idempotent (safe to re-run), validates JS, backs up changes.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch57-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, c) { fs.writeFileSync(p, c, { encoding: 'utf8' }); }
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
log('TapMyCar Patch 57 (Stage 6-b) - Announcement popup + checkbox');
log('=============================================================');

// ----------------------------------------------------------------------------
// STEP 1 - public/app.js : the popup
// ----------------------------------------------------------------------------
log('');
log('Step 1 - public/app.js (in-app announcement popup)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = fs.readFileSync(appPath, 'utf8');

if (appSrc.indexOf('TMC_PATCH57_ANNOUNCE_POPUP') !== -1) {
  skip('public/app.js');
} else {
  backup(appPath, 'public/app.js');

  const POPUP = [
    '',
    '// TMC_PATCH57_ANNOUNCE_POPUP - in-app announcement popup.',
    '// On page load, a logged-in user is shown the newest announcement they',
    '// have not yet dismissed. Dismissing records it so it never shows again.',
    '(function () {',
    '  function tmcEscAnn(s) {',
    '    return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) {',
    '      return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\\"": "&quot;" })[c];',
    '    });',
    '  }',
    '',
    '  function showAnnouncementPopup(ann, userId) {',
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
    '      \'<div style="background:#fff;max-width:380px;width:100%;border-radius:16px;\' +',
    '        \'box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden">\' +',
    '        \'<div style="padding:24px 22px 18px">\' +',
    '          \'<div style="font-size:13px;font-weight:700;color:#FF6B00;\' +',
    '            \'text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">\' +',
    '            \'Announcement</div>\' +',
    '          \'<div style="font-size:17px;font-weight:800;color:#111;\' +',
    '            \'margin-bottom:8px">\' + tmcEscAnn(ann.title) + \'</div>\' +',
    '          \'<div style="font-size:14px;line-height:1.6;color:#374151">\' +',
    '            bodyHtml + \'</div>\' +',
    '        \'</div>\' +',
    '        \'<div style="display:flex;border-top:1px solid #E5E7EB">\' +',
    '          \'<button id="tmc-ann-close" style="flex:1;padding:14px;border:none;\' +',
    '            \'background:#fff;font-size:14px;font-weight:700;color:#6B7280;\' +',
    '            \'cursor:pointer;font-family:inherit">Close</button>\' +',
    '          \'<button id="tmc-ann-view" style="flex:1;padding:14px;border:none;\' +',
    '            \'border-left:1px solid #E5E7EB;background:#fff;font-size:14px;\' +',
    '            \'font-weight:700;color:#FF6B00;cursor:pointer;font-family:inherit">\' +',
    '            \'View Inbox</button>\' +',
    '        \'</div>\' +',
    '      \'</div>\';',
    '',
    '    document.body.appendChild(overlay);',
    '',
    '    // Record the dismissal so this announcement never shows again.',
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
    '    document.getElementById("tmc-ann-view").onclick = function () {',
    '      markSeen();',
    '      window.location.href = "/activity.html";',
    '    };',
    '    overlay.addEventListener("click", function (e) {',
    '      if (e.target === overlay) dismiss();',
    '    });',
    '  }',
    '',
    '  function checkAnnouncement() {',
    '    var token = null;',
    '    try { token = localStorage.getItem("tmc_token"); } catch (e) {}',
    '    if (!token) return;  // only logged-in users see in-app popups',
    '',
    '    fetch("/api/get-announcement?user_id=" + encodeURIComponent(token))',
    '      .then(function (r) { return r.json(); })',
    '      .then(function (d) {',
    '        if (d && d.success && d.announcement) {',
    '          showAnnouncementPopup(d.announcement, token);',
    '        }',
    '      })',
    '      .catch(function () { /* silent - popup is non-critical */ });',
    '  }',
    '',
    '  document.addEventListener("DOMContentLoaded", function () {',
    '    setTimeout(checkAnnouncement, 1200);',
    '  });',
    '})();',
    ''
  ].join('\n');

  // Append at end of file.
  if (appSrc.charAt(appSrc.length - 1) !== '\n') appSrc += '\n';
  appSrc += POPUP;
  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
  ok('Announcement popup added to app.js');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/admin.html : the checkbox + payload
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/admin.html (Also show as in-app popup checkbox)');

const adminPath = path.join(PUBLIC, 'admin.html');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH57_ANNOUNCE_POPUP') !== -1) {
  skip('public/admin.html');
} else {
  if (html.indexOf('id="bc-send-btn"') === -1) {
    errExit('Broadcast Send button not found - apply Patches 44-48 first.');
  }
  backup(adminPath, 'public/admin.html');

  // 2a - insert the checkbox just above the Send button.
  const SEND_ANCHOR =
    '            <button type="button" class="bc-btn" id="bc-send-btn"\r\n' +
    '              onclick="bcSend()">Send broadcast</button>\r\n';
  const CHK = 'style="display:inline-flex;align-items:center;gap:8px;' +
    'margin-bottom:14px;font-size:14px;font-weight:600;color:#374151;cursor:pointer"';
  const CHECKBOX =
    '            <!-- TMC_PATCH57_ANNOUNCE_POPUP -->\r\n' +
    '            <label ' + CHK + '>\r\n' +
    '              <input type="checkbox" id="bc-also-inapp"> Also show as in-app popup\r\n' +
    '            </label>\r\n' +
    '            <div class="bc-note" style="margin-bottom:14px">\r\n' +
    '              When ticked, this message also appears as a popup inside TapMyCar\r\n' +
    '              the next time each logged-in user opens the app.\r\n' +
    '            </div>\r\n' +
    SEND_ANCHOR;
  html = replaceOnce(html, SEND_ANCHOR, CHECKBOX, 'Edit 2a checkbox');
  ok('Edit 2a - "Also show as in-app popup" checkbox added');

  // 2b - include also_in_app in the bcSend() payload.
  const PAYLOAD_OLD =
    '    bcApi({ channels: channels, subject: subject, body: body, recipients: rcp })';
  const PAYLOAD_NEW =
    '    var alsoInApp = false;\r\n' +
    '    var aiEl = document.getElementById("bc-also-inapp");\r\n' +
    '    if (aiEl) alsoInApp = aiEl.checked;\r\n' +
    '    bcApi({ channels: channels, subject: subject, body: body, recipients: rcp, also_in_app: alsoInApp })';
  html = replaceOnce(html, PAYLOAD_OLD, PAYLOAD_NEW, 'Edit 2b payload');
  ok('Edit 2b - bcSend payload now sends also_in_app');

  fs.writeFileSync(adminPath, html, { encoding: 'utf8' });
  ok('public/admin.html written');
}

// ----------------------------------------------------------------------------
// STEP 3 - sync to root
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync to root');
[['app.js', appPath], ['admin.html', adminPath]].forEach(function (pair) {
  const rootCopy = path.join(ROOT, pair[0]);
  if (fs.existsSync(rootCopy)) {
    backup(rootCopy, 'root-' + pair[0]);
    fs.copyFileSync(pair[1], rootCopy);
    ok('Synced ' + pair[0] + ' -> root');
  }
});

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('=============================================================');
log('Patch 57 (Stage 6-b) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh.');
log('');
log('  TEST:');
log('   1. /admin.html -> Broadcast tab: under the channels there is now an');
log('      "Also show as in-app popup" checkbox.');
log('   2. Compose a message, tick that checkbox, pick Specific + your own');
log('      email, Send.');
log('   3. Open /dashboard.html (signed in as a normal user). After ~1s a');
log('      centered popup appears with the title, message and Close /');
log('      View Inbox buttons.');
log('   4. Click Close -> popup goes away. Reload the page -> it does NOT');
log('      come back (shown once per user).');
log('');
log('  Note: an announcement you already dismissed in earlier testing will');
log('  not reappear. If no popup shows, send a NEW one with the checkbox.');
log('');
