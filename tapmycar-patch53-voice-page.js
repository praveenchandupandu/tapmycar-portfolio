// ============================================================================
// TapMyCar - Patch 53: Branded voice-memo page (fix raw-audio-link issue)
//
// PROBLEM
//   The "Listen to voice memo" button in the stranger-voice-memo email links
//   straight to the raw Supabase storage file (...supabase.co/.../voice-*.webm).
//   Tapping it opens a bare black browser audio player - looks broken and
//   off-brand (see the user's screenshot).
//
// WHAT THIS PATCH DOES
//   1. public/voice.html - NEW. A small branded TapMyCar page with a proper
//      audio player. It reads the audio file URL from its own query string
//      (?a=<encoded url>&d=<duration>&v=<vehicle label>) and plays it inside
//      a styled card - no raw black player, no database call needed.
//   2. api/notify-owner.js - the email's "Listen to voice memo" button now
//      points at  https://tapmycar.io/voice.html?a=...  instead of the raw
//      storage URL. The separate "View Activity" button is unchanged.
//   3. Syncs public/voice.html -> root.
//
//   No SQL change. No vercel.json change (voice.html is a static file).
//
// Properties: idempotent (safe to re-run), validates JS, backs up changed files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch53-${ts}`);

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
log('TapMyCar Patch 53 - Branded voice-memo page');
log('===========================================');

// ----------------------------------------------------------------------------
// STEP 1 - create public/voice.html
// ----------------------------------------------------------------------------
log('');
log('Step 1 - public/voice.html (NEW)');

const VOICE_HTML = [
  '<!DOCTYPE html>',
  '<!-- TMC_PATCH53_VOICE -->',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <meta name="theme-color" content="#FF6B00">',
  '  <title>Voice memo \u2014 TapMyCar</title>',
  '  <link rel="icon" type="image/x-icon" href="/favicon.ico">',
  '  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
  '  <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '  <meta name="robots" content="noindex">',
  '  <style>',
  '    *{box-sizing:border-box;margin:0;padding:0}',
  '    body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;',
  '      background:#F9FAFB;color:#111;min-height:100vh;display:flex;',
  '      align-items:center;justify-content:center;padding:24px}',
  '    .card{background:#fff;max-width:440px;width:100%;border-radius:18px;',
  '      border:1px solid #E5E7EB;padding:34px 28px;text-align:center;',
  '      box-shadow:0 4px 24px rgba(0,0,0,.05)}',
  '    .brand{font-size:22px;font-weight:800;margin-bottom:6px}',
  '    .brand span{color:#FF6B00}',
  '    .tag{font-size:13px;color:#6B7280;margin-bottom:24px}',
  '    .icon{width:56px;height:56px;border-radius:50%;margin:0 auto 16px;',
  '      background:#F5F3FF;color:#6D28D9;display:flex;align-items:center;',
  '      justify-content:center;font-size:26px}',
  '    h1{font-size:19px;font-weight:800;margin-bottom:8px}',
  '    p{font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:20px}',
  '    audio{width:100%;margin:8px 0 20px}',
  '    .btn{display:block;background:#FF6B00;color:#fff;font-size:14px;',
  '      font-weight:700;padding:13px 0;border-radius:12px;text-decoration:none}',
  '    .btn:hover{background:#E65F00}',
  '    .err{font-size:13px;color:#991B1B;background:#FEE2E2;border-radius:10px;',
  '      padding:12px;margin-bottom:16px}',
  '    .foot{margin-top:22px;font-size:11px;color:#9CA3AF}',
  '  </style>',
  '</head>',
  '<body>',
  '  <div class="card">',
  '    <div class="brand">TapMyCar<span>.</span></div>',
  '    <div class="tag">Privacy for you. Safety for your car.</div>',
  '    <div class="icon">\u266a</div>',
  '    <h1>Voice memo</h1>',
  '    <div id="content"><p>Loading\u2026</p></div>',
  '    <div class="foot">Praman Tech LLC \u00b7 Connecticut, USA</div>',
  '  </div>',
  '  <script>',
  '  (function(){',
  '    var p = new URLSearchParams(location.search);',
  '    var audio = p.get("a");',
  '    var dur = p.get("d");',
  '    var veh = p.get("v");',
  '    var box = document.getElementById("content");',
  '    function esc(s){',
  '      return String(s == null ? "" : s).replace(/[<>&"]/g, function(c){',
  '        return ({"<":"&lt;",">":"&gt;","&":"&amp;","\\"":"&quot;"})[c];',
  '      });',
  '    }',
  '    if(!audio){',
  '      box.innerHTML = \'<div class="err">This voice memo link is missing or \' +',
  '        \'invalid. Open your Activity page to find it.</div>\' +',
  '        \'<a class="btn" href="/activity.html">Go to Activity</a>\';',
  '      return;',
  '    }',
  '    var who = veh ? ("on " + esc(veh)) : "on your vehicle";',
  '    var len = dur ? (" \\u00b7 " + esc(dur) + "s") : "";',
  '    box.innerHTML =',
  '      \'<p>Someone scanned your tag \' + who + \' and left a voice memo\' + len + \'.</p>\' +',
  '      \'<audio controls preload="metadata" src="\' + encodeURI(audio) + \'"></audio>\' +',
  '      \'<a class="btn" href="/activity.html">View all activity</a>\';',
  '  })();',
  '  </script>',
  '</body>',
  '</html>',
  ''
].join('\n');

const voicePub = path.join(PUBLIC, 'voice.html');
if (fs.existsSync(voicePub) &&
    fs.readFileSync(voicePub, 'utf8').indexOf('TMC_PATCH53_VOICE') !== -1) {
  skip('public/voice.html');
} else {
  backup(voicePub, 'public/voice.html');
  writeFile(voicePub, VOICE_HTML);
  ok('Created public/voice.html');
}

// ----------------------------------------------------------------------------
// STEP 2 - repoint the email "Listen" button in api/notify-owner.js
// ----------------------------------------------------------------------------
log('');
log('Step 2 - api/notify-owner.js (repoint Listen button)');

const notifyPath = path.join(API, 'notify-owner.js');
let notifySrc = fs.readFileSync(notifyPath, 'utf8');

if (notifySrc.indexOf('TMC_PATCH53_VOICE') !== -1) {
  skip('api/notify-owner.js');
} else {
  backup(notifyPath, 'api/notify-owner.js');

  // The exact current audioHtml line (links straight to the raw audioUrl).
  const OLD_AUDIO_HTML =
    "    const audioHtml = audioUrl\n" +
    "      ? '<a href=\"' + audioUrl + '\" style=\"display:inline-block;background:#6D28D9;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-bottom:12px\">Listen to voice memo (' + duration + 's)</a>'\n" +
    "      : '<p style=\"font-size:12px;color:#6B7280\">Voice memo could not be processed. Please check your dashboard.</p>';\n";

  // New version: button points at the branded voice.html page, passing the
  // audio URL, duration and vehicle label as query params.
  const NEW_AUDIO_HTML =
    "    // TMC_PATCH53_VOICE: link to the branded voice.html page, not the raw file.\n" +
    "    const voicePageUrl = 'https://tapmycar.io/voice.html?a=' + encodeURIComponent(audioUrl) +\n" +
    "      '&d=' + encodeURIComponent(duration) + '&v=' + encodeURIComponent(vehicleLabel || '');\n" +
    "    const audioHtml = audioUrl\n" +
    "      ? '<a href=\"' + voicePageUrl + '\" style=\"display:inline-block;background:#6D28D9;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;margin-bottom:12px\">Listen to voice memo (' + duration + 's)</a>'\n" +
    "      : '<p style=\"font-size:12px;color:#6B7280\">Voice memo could not be processed. Please check your dashboard.</p>';\n";

  notifySrc = replaceOnce(notifySrc, OLD_AUDIO_HTML, NEW_AUDIO_HTML, 'Listen button repoint');
  writeFile(notifyPath, notifySrc);
  checkJs(notifyPath, 'api/notify-owner.js');
  ok('Email "Listen" button now points at voice.html');
}

// ----------------------------------------------------------------------------
// STEP 3 - sync voice.html to root
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync to root');
const voiceRoot = path.join(ROOT, 'voice.html');
backup(voiceRoot, 'root-voice.html');
fs.copyFileSync(voicePub, voiceRoot);
ok('Synced voice.html -> root');

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('===========================================');
log('Patch 53 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s. To test, you need a voice memo:');
log('   1. On a phone, scan one of your tags and leave a voice memo as a');
log('      "stranger" (the normal stranger flow).');
log('   2. The owner email arrives. Tap "Listen to voice memo" -> it now');
log('      opens the branded TapMyCar voice.html page with a clean player,');
log('      NOT the raw black supabase.co player.');
log('   3. The audio plays in the styled card; "View all activity" links');
log('      on to /activity.html.');
log('');
log('  Quick check without a real memo: open');
log('    https://tapmycar.io/voice.html');
log('  with no parameters -> it should show the branded "link invalid"');
log('  card with a "Go to Activity" button (proves the page deployed).');
log('');
