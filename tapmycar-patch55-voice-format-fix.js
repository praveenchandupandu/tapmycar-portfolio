// ============================================================================
// TapMyCar - Patch 55: Voice recorder - use an iOS-playable audio format
//
// PROBLEM
//   Voice memos recorded as .webm cannot be played back on iPhones (Safari /
//   iOS Chrome do not support webm audio). The recorder in contact.html:
//     - creates MediaRecorder with NO mimeType -> device default,
//     - then HARDCODES the blob type to 'audio/webm' (wrong on iOS),
//     - and HARDCODES audio_type:'audio/webm' in the upload payload.
//   So a memo recorded on Android (webm) is unplayable for any iPhone owner,
//   and even iPhone-recorded mp4 audio gets mislabelled as webm.
//
// FIX (3 edits to public/contact.html)
//   1. At record time, pick the best mimeType the browser supports, in this
//      order:  audio/mp4  ->  audio/webm;codecs=opus  ->  audio/webm.
//      audio/mp4 (AAC) plays on iOS, Android and desktop. Recording IN mp4
//      when supported means the memo is universally playable.
//   2. The blob and the playback now use the recorder's ACTUAL mimeType,
//      not a hardcoded string.
//   3. The upload payload sends the ACTUAL mimeType as audio_type. The
//      backend (notify-owner.js) already derives the file extension from
//      audio_type, so .mp4 memos get an .m4a file automatically - no
//      backend change needed.
//
//   Note: this fixes memos recorded FROM NOW ON. Memos already stored as
//   .webm stay .webm - nothing can retro-convert them.
//
//   No SQL change. No backend change. Syncs contact.html -> root.
//
// Properties: idempotent (safe to re-run), backs up contact.html before edit.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch55-${ts}`);

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
  if (idx === -1) errExit(label + ': anchor not found - contact.html differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 55 - Voice recorder iOS-playable format');
log('======================================================');

const contactPath = path.join(PUBLIC, 'contact.html');
if (!fs.existsSync(contactPath)) errExit('public/contact.html not found');
let html = fs.readFileSync(contactPath, 'utf8');

if (html.indexOf('TMC_PATCH55_VOICEFMT') !== -1) {
  skip('public/contact.html');
} else {
  backup(contactPath, 'public/contact.html');

  // --- EDIT 1: MediaRecorder creation - choose a supported, iOS-friendly type ---
  const OLD_REC =
    "    v6MediaRecorder = new MediaRecorder(stream);\n";
  const NEW_REC =
    "    // TMC_PATCH55_VOICEFMT: record in a format iPhones can play.\n" +
    "    // audio/mp4 (AAC) plays on iOS + Android + desktop; webm does NOT on iOS.\n" +
    "    var v6Candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];\n" +
    "    var v6PickedType = '';\n" +
    "    for (var v6i = 0; v6i < v6Candidates.length; v6i++) {\n" +
    "      if (window.MediaRecorder && MediaRecorder.isTypeSupported &&\n" +
    "          MediaRecorder.isTypeSupported(v6Candidates[v6i])) {\n" +
    "        v6PickedType = v6Candidates[v6i]; break;\n" +
    "      }\n" +
    "    }\n" +
    "    v6MediaRecorder = v6PickedType\n" +
    "      ? new MediaRecorder(stream, { mimeType: v6PickedType })\n" +
    "      : new MediaRecorder(stream);\n";
  html = replaceOnce(html, OLD_REC, NEW_REC, 'Edit 1 recorder mimeType');
  ok('Edit 1 - recorder picks an iOS-playable format');

  // --- EDIT 2: blob uses the recorder's actual mimeType, not hardcoded webm ---
  const OLD_BLOB =
    "      v6AudioBlob = new Blob(v6AudioChunks, { type: 'audio/webm' });\n";
  const NEW_BLOB =
    "      // TMC_PATCH55_VOICEFMT: use the ACTUAL recorded type, never hardcode.\n" +
    "      var v6BlobType = (v6MediaRecorder && v6MediaRecorder.mimeType) ||\n" +
    "        v6PickedType || 'audio/webm';\n" +
    "      v6AudioBlob = new Blob(v6AudioChunks, { type: v6BlobType });\n";
  html = replaceOnce(html, OLD_BLOB, NEW_BLOB, 'Edit 2 blob type');
  ok('Edit 2 - blob uses the real recorded type');

  // --- EDIT 3: upload payload sends the actual type, not hardcoded webm ---
  const OLD_UP = "        audio_type: 'audio/webm',\n";
  const NEW_UP =
    "        /* TMC_PATCH55_VOICEFMT: send the real type so the backend picks\n" +
    "           the correct file extension (.m4a for mp4, .webm for webm). */\n" +
    "        audio_type: (v6AudioBlob && v6AudioBlob.type) || 'audio/webm',\n";
  html = replaceOnce(html, OLD_UP, NEW_UP, 'Edit 3 upload audio_type');
  ok('Edit 3 - upload sends the real audio type');

  fs.writeFileSync(contactPath, html, { encoding: 'utf8' });
  ok('public/contact.html written');
}

log('');
log('Sync to root');
const contactRoot = path.join(ROOT, 'contact.html');
backup(contactRoot, 'root-contact.html');
fs.copyFileSync(contactPath, contactRoot);
ok('Synced contact.html -> root');

log('');
log('======================================================');
log('Patch 55 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, then test with a NEW voice memo:');
log('   1. On a phone, scan a tag and record + send a voice memo.');
log('   2. Open the owner email on your iPhone, tap "Listen to voice memo".');
log('      The branded player should now PLAY - no "Error".');
log('   3. To confirm the format changed, check the newest file:');
log('        select audio_url from scan_logs');
log('        where audio_url is not null order by scanned_at desc limit 1;');
log('      The filename should now end in .m4a (recorded on iOS/most');
log('      browsers) instead of .webm.');
log('');
log('  Note: voice memos recorded BEFORE this patch stay .webm and remain');
log('  unplayable on iPhone - only new memos get the iOS-friendly format.');
log('');
