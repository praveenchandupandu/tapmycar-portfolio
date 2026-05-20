// ============================================================================
// TapMyCar - Patch 35d: Graceful call endings (pause before hangup)
//
// Problem reported by user (and the call owner): at the end of a call the
// closing line (e.g. "you really helped out today!") gets cut off
// mid-sentence and the call drops abruptly, feeling like a network glitch.
//
// Cause: Twilio TwiML has <Say> immediately followed by <Hangup/>. The
// text-to-speech audio is still streaming when <Hangup/> fires, so the
// last word or two get clipped.
//
// Fix: insert <Pause length="1"/> between every closing <Say> and its
// <Hangup/>. One second of silence lets the speech audio fully play out
// before the call ends, so goodbyes sound complete and intentional.
//
// Files touched (all TwiML voice flows):
//   - api/voice-action.js     (3 spots)
//   - api/owner-callback.js   (2 spots)
//   - api/inbound-call.js     (2 spots)
//   - api/stranger-wait.js    (2 spots)
//
// Properties: idempotent, per-file backup, JS validation, safeReplace.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35d-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

log('');
log('TapMyCar Patch 35d \u2014 graceful call endings (pause before hangup)');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35D_GRACEFUL_HANGUP';
const PAUSE = '<Pause length="1"/>';

/* Strategy: for each file, find every occurrence of a closing </Say>
   followed (with only whitespace between) by <Hangup/>, and insert a
   <Pause> in between. We do this with a regex that tolerates any
   whitespace/newline shape, so it works regardless of CRLF vs LF and
   indentation.

   We must NOT double-insert: if a <Pause> is already directly before the
   <Hangup/>, skip that occurrence. The regex specifically requires that
   the thing immediately before <Hangup/> is </Say> (not </Pause>). */

const FILES = [
  'voice-action.js',
  'owner-callback.js',
  'inbound-call.js',
  'stranger-wait.js'
];

let grandTotal = 0;

for (const fname of FILES) {
  const file = path.join(API, fname);
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('api/' + fname);
    continue;
  }

  /* Match: </Say>  <whitespace>  <Hangup/>
     Capture the whitespace so we can preserve indentation.
     The negative lookbehind-ish trick: we only match when </Say> is the
     tag right before, which guarantees no <Pause> is already there. */
  const re = /<\/Say>(\s*)<Hangup\s*\/>/g;

  let count = 0;
  const updated = content.replace(re, function(match, ws) {
    count++;
    /* Preserve the whitespace pattern: put the Pause on its own line
       using the same indentation as the Hangup had. */
    /* ws typically looks like "\n  " (newline + indent). We reuse it. */
    return '</Say>' + ws + PAUSE + ws + '<Hangup/>';
  });

  if (count === 0) {
    skip('api/' + fname + ' (no <Say>+<Hangup> pairs found)');
    continue;
  }

  backup(file);

  /* Add marker comment at top so re-runs are detected. */
  const marked = '/* ' + MARKER + ': <Pause> added before <Hangup/> for graceful endings */\n' + updated;
  writeFile(file, marked);

  /* Validate JS */
  try {
    execSync('node --check "' + file + '"', { stdio: 'pipe' });
  } catch (e) {
    errExit('JS syntax error in ' + fname + ': ' + e.stderr.toString());
  }

  ok('api/' + fname + ': ' + count + ' graceful pause(s) inserted');
  grandTotal += count;
}

log('');
log('==============================================================');
if (grandTotal === 0) {
  log('Nothing to do \u2014 all files already patched.');
} else {
  log('Patch 35d complete. ' + grandTotal + ' call ending(s) made graceful.');
}
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35d: graceful call endings (pause before hangup)"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Open https://tapmycar.io/tag/TMC-66TPYH in incognito.');
log('  2. Tap Call Owner, enter a number, answer it.');
log('  3. Go through the flow to the end.');
log('  4. The closing line ("you really helped out today" etc.) should');
log('     now play fully, then a brief beat of silence, then the call');
log('     ends cleanly. No more mid-word cut-off.');
log('');
log('If the goodbye still feels slightly rushed, the pause length can be');
log('bumped from 1 second to 2 \u2014 just ask and I will adjust.');
log('==============================================================');
