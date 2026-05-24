// ============================================================================
// TapMyCar - Patch 61: No-subject announcements show no title (Option A)
//
// PREREQUISITE
//   Patches 58 (popup redesign) and 59/60 (in-app channel) deployed.
//
// PROBLEM
//   When a popup is sent with NO subject, the popup shows "TapMyCar Update"
//   as a heading above the message. That text is the email fallback subject
//   leaking into the popup. The user wants: no subject -> no heading, just
//   the orange "TapMyCar Alert" banner and the message.
//
// FIX (Option A)
//   1. api/send-broadcast.js - the in-app ANNOUNCEMENT now stores the real
//      subject, or an EMPTY string when none was given - NOT the
//      "TapMyCar Update" fallback. (announcements.title is NOT NULL, so an
//      empty string is used, never null.) The EMAIL channel still uses the
//      "TapMyCar Update" fallback for its subject line - emails need one -
//      that part is unchanged.
//   2. public/app.js - the popup only renders the title line when the
//      announcement actually has a non-empty title. Blank title -> the
//      popup shows just the "TapMyCar Alert" banner, the divider, and the
//      message.
//
//   No SQL change. Syncs app.js -> root.
//
// Properties: idempotent (safe to re-run), validates JS, backs up changes.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch61-${ts}`);

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
log('TapMyCar Patch 61 - No-subject popups show no title');
log('===================================================');

// ----------------------------------------------------------------------------
// STEP 1 - api/send-broadcast.js : announcement stores real-or-empty title
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/send-broadcast.js (announcement title)');

const epPath = path.join(API, 'send-broadcast.js');
let epSrc = fs.readFileSync(epPath, 'utf8');

if (epSrc.indexOf('TMC_PATCH61_NOTITLE') !== -1) {
  skip('api/send-broadcast.js');
} else {
  if (epSrc.indexOf("title: effectiveSubject, body: String(body.body),") === -1) {
    errExit('announcement insert anchor not found - is Patch 59 applied?');
  }
  backup(epPath, 'api/send-broadcast.js');

  // The announcement title = the real typed subject, or "" when none.
  // (effectiveSubject is the email fallback - we do NOT want it in the popup.)
  epSrc = replaceOnce(epSrc,
    "      const { error: annErr } = await supabase.from('announcements').insert({\n" +
    "        title: effectiveSubject, body: String(body.body),\n" +
    "        active: true, created_by: 'admin', broadcast_id: broadcastId\n" +
    "      });",
    "      // TMC_PATCH61_NOTITLE: store the real subject, or \"\" when none was\n" +
    "      // given - so a no-subject popup shows no heading. Email keeps the\n" +
    "      // \"TapMyCar Update\" fallback separately; that does not come here.\n" +
    "      const annTitle = (subject && String(subject).trim()) ? String(subject).trim() : '';\n" +
    "      const { error: annErr } = await supabase.from('announcements').insert({\n" +
    "        title: annTitle, body: String(body.body),\n" +
    "        active: true, created_by: 'admin', broadcast_id: broadcastId\n" +
    "      });",
    'announcement title');
  writeFile(epPath, epSrc);
  checkJs(epPath, 'api/send-broadcast.js');
  ok('Announcement now stores the real subject (empty when none)');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/app.js : popup skips an empty title
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/app.js (popup skips empty title)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = fs.readFileSync(appPath, 'utf8');

if (appSrc.indexOf('TMC_PATCH61_NOTITLE') !== -1) {
  skip('public/app.js');
} else {
  // The title <div> is built inline. Replace it with a conditional piece
  // that is empty string when the announcement has no title.
  const TITLE_OLD =
    "          '<div style=\"font-size:15px;font-weight:700;color:#111;' +\n" +
    "            'margin-bottom:8px\">' + tmcEscAnn(ann.title) + '</div>' +\n";
  const TITLE_NEW =
    "          /* TMC_PATCH61_NOTITLE: show the title row only when there is one */\n" +
    "          ((ann.title && String(ann.title).trim())\n" +
    "            ? ('<div style=\"font-size:15px;font-weight:700;color:#111;' +\n" +
    "               'margin-bottom:8px\">' + tmcEscAnn(ann.title) + '</div>')\n" +
    "            : '') +\n";
  appSrc = replaceOnce(appSrc, TITLE_OLD, TITLE_NEW, 'popup title conditional');
  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
  ok('Popup now skips the title line when the announcement has no title');
}

// ----------------------------------------------------------------------------
// STEP 3 - sync app.js to root
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync to root');
const appRoot = path.join(ROOT, 'app.js');
if (fs.existsSync(appRoot)) {
  backup(appRoot, 'root-app.js');
  fs.copyFileSync(appPath, appRoot);
  ok('Synced app.js -> root');
}

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('===================================================');
log('Patch 61 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh.');
log('  TEST:');
log('   1. Broadcast tab: tick ONLY "In-app popup", leave Subject BLANK,');
log('      type a short message, Send.');
log('   2. Open /dashboard.html as a normal user -> the popup shows the');
log('      orange "TapMyCar Alert" banner, the divider, and your message -');
log('      with NO "TapMyCar Update" heading.');
log('   3. Send another WITH a subject -> that subject DOES appear as the');
log('      heading, as before.');
log('');
log('  Note: announcements created before this patch keep whatever title');
log('  they were saved with. Only new ones get the new behaviour.');
log('');
