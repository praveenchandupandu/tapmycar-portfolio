// ============================================================================
// TapMyCar - Patch 54: Verify voice memo is ready before emailing
//
// PREREQUISITE
//   Patch 53 deployed (voice.html page + voicePageUrl in notify-owner.js).
//
// PROBLEM
//   Supabase storage has a short lag between "upload finished" and "the
//   public URL reliably serves the file". The owner email is sent right
//   after upload, so if they tap "Listen" within the first few seconds the
//   audio player shows "Error". Reopening later works.
//
// FIX (verify-then-send)
//   Before building the email, probe the audio URL with a HEAD request,
//   retrying up to 4 times (~1.2s apart, ~5s worst case - safely inside the
//   10s function limit). Outcomes:
//     - file confirmed reachable -> email's "Listen" button uses voice.html
//       (the branded player) as normal.
//     - still not reachable after retries (rare) -> email still sends, but
//       the "Listen" button instead points at /activity.html, so the link
//       is NEVER broken and the email is NEVER stuck unsent.
//
//   The audio is also stored on scan_logs regardless, so the activity page
//   always has it once storage catches up.
//
//   No SQL change. No vercel.json change. One edit to api/notify-owner.js.
//
// Properties: idempotent (safe to re-run), validates JS, backs up the file.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch54-${ts}`);

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
  if (idx === -1) errExit(label + ': anchor not found - notify-owner.js differs (is Patch 53 applied?).');
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
log('TapMyCar Patch 54 - Verify voice memo before emailing');
log('=====================================================');

const notifyPath = path.join(API, 'notify-owner.js');
if (!fs.existsSync(notifyPath)) errExit('api/notify-owner.js not found');
let src = fs.readFileSync(notifyPath, 'utf8');

if (src.indexOf('TMC_PATCH54_VOICEREADY') !== -1) {
  skip('api/notify-owner.js');
} else {
  if (src.indexOf('TMC_PATCH53_VOICE') === -1) {
    errExit('Patch 53 marker not found - apply Patch 53 first.');
  }
  backup(notifyPath, 'api/notify-owner.js');

  // Anchor: the Patch 53 block (subject line through audioHtml fallback).
  const OLD =
    "    subject = 'Someone sent you a voice memo via TapMyCar';\n" +
    "    // TMC_PATCH53_VOICE: link to the branded voice.html page, not the raw file.\n" +
    "    const voicePageUrl = 'https://tapmycar.io/voice.html?a=' + encodeURIComponent(audioUrl) +\n" +
    "      '&d=' + encodeURIComponent(duration) + '&v=' + encodeURIComponent(vehicleLabel || '');\n" +
    "    const audioHtml = audioUrl\n" +
    "      ? '<a href=\"' + voicePageUrl + '\" style=\"display:inline-block;background:#6D28D9;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-bottom:12px\">Listen to voice memo (' + duration + 's)</a>'\n" +
    "      : '<p style=\"font-size:12px;color:#6B7280\">Voice memo could not be processed. Please check your dashboard.</p>';\n";

  const NEW =
    "    subject = 'Someone sent you a voice memo via TapMyCar';\n" +
    "    // TMC_PATCH53_VOICE: link to the branded voice.html page, not the raw file.\n" +
    "    const voicePageUrl = 'https://tapmycar.io/voice.html?a=' + encodeURIComponent(audioUrl) +\n" +
    "      '&d=' + encodeURIComponent(duration) + '&v=' + encodeURIComponent(vehicleLabel || '');\n" +
    "\n" +
    "    // TMC_PATCH54_VOICEREADY: Supabase storage lags slightly between upload\n" +
    "    // finishing and the public URL serving reliably. Probe the file with a\n" +
    "    // few HEAD requests before sending, so the owner never opens a broken\n" +
    "    // player. ~5s worst case - safely inside the 10s function limit.\n" +
    "    async function voiceFileReady(url) {\n" +
    "      if (!url) return false;\n" +
    "      for (let attempt = 0; attempt < 4; attempt++) {\n" +
    "        try {\n" +
    "          const r = await fetch(url, { method: 'HEAD' });\n" +
    "          if (r && r.ok) return true;\n" +
    "        } catch (e) { /* network hiccup - retry */ }\n" +
    "        await new Promise(function (res) { setTimeout(res, 1200); });\n" +
    "      }\n" +
    "      return false;\n" +
    "    }\n" +
    "    let audioReady = false;\n" +
    "    if (audioUrl) {\n" +
    "      audioReady = await voiceFileReady(audioUrl);\n" +
    "      if (!audioReady) {\n" +
    "        console.warn('Voice file not reachable after retries; emailing with Activity fallback link.');\n" +
    "      }\n" +
    "    }\n" +
    "    // If the file is confirmed ready -> link to the branded player page.\n" +
    "    // If not -> link to the Activity page so the email is never broken.\n" +
    "    const listenUrl = audioReady ? voicePageUrl : 'https://tapmycar.io/activity.html';\n" +
    "    const audioHtml = audioUrl\n" +
    "      ? '<a href=\"' + listenUrl + '\" style=\"display:inline-block;background:#6D28D9;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-bottom:12px\">Listen to voice memo (' + duration + 's)</a>'\n" +
    "      : '<p style=\"font-size:12px;color:#6B7280\">Voice memo could not be processed. Please check your dashboard.</p>';\n";

  src = replaceOnce(src, OLD, NEW, 'voice-ready verify block');
  writeFile(notifyPath, src);
  checkJs(notifyPath, 'api/notify-owner.js');
  ok('Email now verifies the voice file is reachable before sending');
}

log('');
log('=====================================================');
log('Patch 54 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. Then test the full stranger voice flow:');
log('   1. On a phone, scan one of your tags and leave a voice memo.');
log('   2. The owner email arrives a couple of seconds later than before');
log('      (that is the readiness check working).');
log('   3. Tap "Listen to voice memo" IMMEDIATELY - the player should now');
log('      work first try, no "Error", because the email waited for the');
log('      file to be ready.');
log('');
log('  The audio also still appears on /activity.html as before.');
log('');
