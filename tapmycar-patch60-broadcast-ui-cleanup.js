// ============================================================================
// TapMyCar - Patch 60 (Stage 7-b): Broadcast UI - in-app channel + optional subject
//
// PREREQUISITE
//   Patch 59 deployed (backend supports the 'inapp' channel + optional subject).
//
// WHAT THIS PATCH DOES (edits public/admin.html, then syncs to root)
//   1. Adds "In-app popup" as a 4th channel checkbox, next to Email / Web
//      push / SMS - so you can send a popup on its own.
//   2. Updates the channel note to describe the in-app channel.
//   3. Removes the old separate "Also show as in-app popup" checkbox + its
//      note (in-app is now a proper channel, so the side-checkbox is
//      redundant).
//   4. Marks the Subject field "(optional)" and updates its placeholder.
//   5. Updates the broadcast script:
//        - bcChannels() now includes 'inapp',
//        - CH_LABEL gains an 'inapp' label,
//        - the "Enter a subject" validation is removed (subject optional),
//        - bcSend() no longer reads the deleted bc-also-inapp checkbox; it
//          just sends the channels array (inapp included when ticked).
//   6. Syncs admin.html -> root.
//
//   No SQL change. No backend change.
//
// Properties: idempotent (safe to re-run), backs up admin.html before editing.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch60-${ts}`);

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
log('TapMyCar Patch 60 (Stage 7-b) - Broadcast UI: in-app channel');
log('============================================================');

const adminPath = path.join(PUBLIC, 'admin.html');
if (!fs.existsSync(adminPath)) errExit('public/admin.html not found');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH60_INAPP_UI') !== -1) {
  skip('public/admin.html');
} else {
  if (html.indexOf('id="bc-ch-sms"') === -1) {
    errExit('Channel checkboxes not found - apply Patches 44-57 first.');
  }
  backup(adminPath, 'public/admin.html');

  const CHK_STYLE = 'style="display:inline-flex;align-items:center;gap:6px;' +
    'margin-right:18px;font-size:14px;font-weight:600;color:#374151;cursor:pointer"';

  // --- EDIT 1: add the In-app popup checkbox after the SMS checkbox ---
  const SMS_CHK =
    '              <label style="display:inline-flex;align-items:center;gap:6px;margin-right:18px;font-size:14px;font-weight:600;color:#374151;cursor:pointer">\r\n' +
    '                <input type="checkbox" id="bc-ch-sms" onchange="bcResetCount()"> SMS</label>\r\n';
  const SMS_PLUS_INAPP = SMS_CHK +
    '              <!-- TMC_PATCH60_INAPP_UI -->\r\n' +
    '              <label ' + CHK_STYLE + '>\r\n' +
    '                <input type="checkbox" id="bc-ch-inapp" onchange="bcResetCount()"> In-app popup</label>\r\n';
  html = replaceOnce(html, SMS_CHK, SMS_PLUS_INAPP, 'Edit 1 in-app checkbox');
  ok('Edit 1 - "In-app popup" channel checkbox added');

  // --- EDIT 2: update the channel note ---
  const NOTE_OLD =
    '                <b>SMS</b> goes only to users who explicitly opted in (and costs money per message).\r\n';
  const NOTE_NEW =
    '                <b>SMS</b> goes only to users who explicitly opted in (and costs money per message).\r\n' +
    '                <b>In-app popup</b> shows inside TapMyCar the next time each logged-in user opens the app.\r\n';
  html = replaceOnce(html, NOTE_OLD, NOTE_NEW, 'Edit 2 channel note');
  ok('Edit 2 - channel note describes the in-app channel');

  // --- EDIT 3: remove the old separate "Also show as in-app popup" block ---
  const OLD_CHECKBOX_BLOCK =
    '            <!-- TMC_PATCH57_ANNOUNCE_POPUP -->\r\n' +
    '            <label style="display:inline-flex;align-items:center;gap:8px;margin-bottom:14px;font-size:14px;font-weight:600;color:#374151;cursor:pointer">\r\n' +
    '              <input type="checkbox" id="bc-also-inapp"> Also show as in-app popup\r\n' +
    '            </label>\r\n' +
    '            <div class="bc-note" style="margin-bottom:14px">\r\n' +
    '              When ticked, this message also appears as a popup inside TapMyCar\r\n' +
    '              the next time each logged-in user opens the app.\r\n' +
    '            </div>\r\n';
  html = replaceOnce(html, OLD_CHECKBOX_BLOCK, '', 'Edit 3 remove old checkbox');
  ok('Edit 3 - old separate "Also show as in-app popup" checkbox removed');

  // --- EDIT 4: subject field marked optional ---
  const SUBJ_OLD =
    '              <p class="bc-label">Subject</p>\r\n' +
    '              <input class="bc-input" id="bc-subject" maxlength="150"\r\n' +
    '                placeholder="e.g. Important update about your TapMyCar account">\r\n';
  const SUBJ_NEW =
    '              <p class="bc-label">Subject <span style="color:#9CA3AF;font-weight:600">(optional)</span></p>\r\n' +
    '              <input class="bc-input" id="bc-subject" maxlength="150"\r\n' +
    '                placeholder="Optional - leave blank to send just the message">\r\n';
  html = replaceOnce(html, SUBJ_OLD, SUBJ_NEW, 'Edit 4 subject optional');
  ok('Edit 4 - Subject field marked optional');

  // --- EDIT 5a: bcChannels() includes inapp ---
  const BCCH_OLD =
    '    if (document.getElementById("bc-ch-sms").checked)   out.push("sms");\r\n' +
    '    return out;';
  const BCCH_NEW =
    '    if (document.getElementById("bc-ch-sms").checked)   out.push("sms");\r\n' +
    '    var inappEl = document.getElementById("bc-ch-inapp");\r\n' +
    '    if (inappEl && inappEl.checked) out.push("inapp");\r\n' +
    '    return out;';
  html = replaceOnce(html, BCCH_OLD, BCCH_NEW, 'Edit 5a bcChannels');
  ok('Edit 5a - bcChannels() includes the in-app channel');

  // --- EDIT 5b: CH_LABEL gains inapp ---
  html = replaceOnce(html,
    '  var CH_LABEL = { email: "Email", push: "Web push", sms: "SMS" };',
    '  var CH_LABEL = { email: "Email", push: "Web push", sms: "SMS", inapp: "In-app popup" };',
    'Edit 5b CH_LABEL');
  ok('Edit 5b - CH_LABEL has an in-app label');

  // --- EDIT 5c: drop the "Enter a subject" validation ---
  html = replaceOnce(html,
    '    if (!subject) { res.innerHTML = bcMsg("err","Enter a subject."); return; }\r\n',
    '',
    'Edit 5c remove subject validation');
  ok('Edit 5c - "Enter a subject" requirement removed');

  // --- EDIT 5d: bcSend payload - drop bc-also-inapp, send channels as-is ---
  const PAYLOAD_OLD =
    '    var alsoInApp = false;\r\n' +
    '    var aiEl = document.getElementById("bc-also-inapp");\r\n' +
    '    if (aiEl) alsoInApp = aiEl.checked;\r\n' +
    '    bcApi({ channels: channels, subject: subject, body: body, recipients: rcp, also_in_app: alsoInApp })';
  const PAYLOAD_NEW =
    '    bcApi({ channels: channels, subject: subject, body: body, recipients: rcp })';
  html = replaceOnce(html, PAYLOAD_OLD, PAYLOAD_NEW, 'Edit 5d bcSend payload');
  ok('Edit 5d - bcSend sends the channel list (in-app included when ticked)');

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
log('============================================================');
log('Patch 60 (Stage 7-b) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh /admin.html, open Broadcast.');
log('  TEST:');
log('   1. Channels row now has 4 checkboxes: Email, Web push, SMS,');
log('      In-app popup.');
log('   2. Tick ONLY "In-app popup". Leave Subject BLANK. Type just a');
log('      message. Click Send -> it sends with no "subject required"');
log('      error and no email goes out.');
log('   3. Open /dashboard.html as a normal user -> the popup appears with');
log('      the message (title shows "TapMyCar Update" since no subject).');
log('   4. The old separate "Also show as in-app popup" checkbox is gone.');
log('');
