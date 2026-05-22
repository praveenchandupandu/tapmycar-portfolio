// ============================================================================
// TapMyCar - Patch 40: Chatbot logo + personalized greeting
//
// TWO SMALL IMPROVEMENTS TO THE IN-APP CHATBOT (public/app.js):
//
//   1. LOGO IN THE HEADER
//      The chat window header currently shows a plain white shield icon.
//      This replaces it with the real TapMyCar logo (public/logo.png),
//      placed inside a white circle so its colours stand out against the
//      orange header.
//
//   2. PERSONALIZED GREETING
//      The opening message is always "Hi there! Welcome to TapMyCar."
//      When a user is signed in we already store their name in
//      localStorage as 'tmc_name' (saved by saveSession()). This patch
//      makes the chatbot greet a signed-in user by their first name,
//      e.g. "Hi Praveen! Welcome back to TapMyCar. How can I help?"
//      Signed-out visitors still get the friendly generic greeting.
//
// HOW THE GREETING WORKS
//   The greeting bubble is given an id. Right after the chatbot is
//   injected, a small personalizeChatGreeting() function reads tmc_name
//   and, if present, rewrites the bubble text with the first name.
//
// Properties: idempotent, validates JS, backs up changed files.
//             Only touches public/app.js (and syncs root app.js).
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch40-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' }); // UTF-8, no BOM
}
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
// Replace exactly one occurrence; function replacer keeps '$' literal.
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor text not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor text appears more than once - cannot safely patch.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 40 - Chatbot logo + personalized greeting');
log('========================================================');

const appPath = path.join(PUBLIC, 'app.js');
let src = readFile(appPath);

if (src.indexOf('TMC_PATCH40') !== -1) {
  skip('public/app.js already has Patch 40');
  log('');
  log('Nothing to do. Patch 40 was already applied.');
  process.exit(0);
}

backup(appPath, 'public/app.js');

// ----------------------------------------------------------------------------
// CHANGE 1 - replace the header shield SVG with the logo image
// ----------------------------------------------------------------------------
log('');
log('Change 1 - logo in chat header');

const HEADER_OLD =
  '        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center">\r\n' +
  '          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>\r\n' +
  '        </div>';

// White circle so the colourful logo reads well on the orange header.
const HEADER_NEW =
  '        <div style="width:36px;height:36px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0"><!-- TMC_PATCH40 -->\r\n' +
  '          <img src="/logo.png" alt="TapMyCar" width="30" height="30" style="display:block;object-fit:contain" />\r\n' +
  '        </div>';

if (src.indexOf(HEADER_OLD) !== -1) {
  src = replaceOnce(src, HEADER_OLD, HEADER_NEW, 'chat header logo');
  ok('Header shield replaced with the TapMyCar logo');
} else {
  // Fall back to a CRLF-agnostic match in case line endings differ.
  const reHeader = /<div style="width:36px;height:36px;border-radius:50%;background:rgba\(255,255,255,\.2\);display:flex;align-items:center;justify-content:center">\s*<svg width="18" height="18"[^]*?<\/svg>\s*<\/div>/;
  if (reHeader.test(src)) {
    src = src.replace(reHeader, function () { return HEADER_NEW; });
    ok('Header shield replaced with the TapMyCar logo (line-ending tolerant)');
  } else {
    errExit('chat header logo: could not locate the shield icon - file differs from expected.');
  }
}

// ----------------------------------------------------------------------------
// CHANGE 2a - give the greeting bubble an id so it can be personalized
// ----------------------------------------------------------------------------
log('');
log('Change 2 - personalized greeting');

const GREET_OLD =
  '<div class="tmc-msg tmc-msg-bot"><div class="tmc-msg-bubble">Hi there! Welcome to TapMyCar. How can I help you today? </div></div>';
const GREET_NEW =
  '<div class="tmc-msg tmc-msg-bot"><div class="tmc-msg-bubble" id="tmc-greeting-bubble">Hi there! Welcome to TapMyCar. How can I help you today?</div></div>';

if (src.indexOf(GREET_OLD) !== -1) {
  src = replaceOnce(src, GREET_OLD, GREET_NEW, 'greeting bubble id');
  ok('Greeting bubble tagged with an id');
} else {
  errExit('greeting bubble: could not locate the welcome message - file differs from expected.');
}

// ----------------------------------------------------------------------------
// CHANGE 2b - add personalizeChatGreeting() and call it after injection
// ----------------------------------------------------------------------------
// The helper runs right after injectChatbot(). It reads tmc_name from
// localStorage, takes the first word as the first name, capitalizes it,
// and rewrites the greeting bubble. Signed-out users keep the generic text.

const HELPER =
  '\r\n' +
  '// TMC_PATCH40 - greet a signed-in user by their first name\r\n' +
  'function personalizeChatGreeting() {\r\n' +
  '  try {\r\n' +
  '    var bubble = document.getElementById(\'tmc-greeting-bubble\');\r\n' +
  '    if (!bubble) return;\r\n' +
  '    var raw = (localStorage.getItem(\'tmc_name\') || \'\').trim();\r\n' +
  '    if (!raw) return; // signed-out visitor - keep the generic greeting\r\n' +
  '    var first = raw.split(/\\s+/)[0];\r\n' +
  '    if (!first) return;\r\n' +
  '    first = first.charAt(0).toUpperCase() + first.slice(1);\r\n' +
  '    bubble.textContent = \'Hi \' + first + \'! Welcome back to TapMyCar. How can I help you today?\';\r\n' +
  '  } catch (e) { /* keep the generic greeting on any error */ }\r\n' +
  '}\r\n';

const INJECT_CALL_OLD =
  'document.addEventListener(\'DOMContentLoaded\', () => {\r\n' +
  '  setTimeout(injectChatbot, 1000);\r\n' +
  '});';
const INJECT_CALL_NEW =
  HELPER +
  '\r\n' +
  'document.addEventListener(\'DOMContentLoaded\', () => {\r\n' +
  '  setTimeout(function () {\r\n' +
  '    injectChatbot();\r\n' +
  '    personalizeChatGreeting();\r\n' +
  '  }, 1000);\r\n' +
  '});';

if (src.indexOf(INJECT_CALL_OLD) !== -1) {
  src = replaceOnce(src, INJECT_CALL_OLD, INJECT_CALL_NEW, 'inject + personalize');
  ok('Greeting now uses the signed-in user\'s first name');
} else {
  // Line-ending tolerant fallback.
  const reInject = /document\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{\s*setTimeout\(injectChatbot,\s*1000\);\s*\}\);/;
  if (reInject.test(src)) {
    src = src.replace(reInject, function () { return INJECT_CALL_NEW; });
    ok('Greeting now uses the signed-in user\'s first name (line-ending tolerant)');
  } else {
    errExit('inject + personalize: could not locate the DOMContentLoaded injector - file differs from expected.');
  }
}

// ----------------------------------------------------------------------------
// Write + sync + validate
// ----------------------------------------------------------------------------
writeFile(appPath, src);
log('');
ok('Saved public/app.js');

log('');
log('Sync to root app.js');
const rootAppPath = path.join(ROOT, 'app.js');
if (fs.existsSync(rootAppPath)) {
  if (readFile(rootAppPath) === src) {
    skip('root app.js already in sync');
  } else {
    backup(rootAppPath, 'app.js');
    writeFile(rootAppPath, src);
    ok('Synced root app.js');
  }
} else {
  log('  \u00b7 no root app.js found - nothing to sync');
}

log('');
log('Validation');
try {
  require('child_process').execSync('node -c "' + appPath + '"');
  ok('public/app.js syntax OK');
} catch (e) {
  errExit('public/app.js failed syntax check - restore from backup.');
}

log('');
log('========================================================');
log('Patch 40 complete.');
if (fs.existsSync(BACKUP_DIR)) log('Backups saved to: ' + path.basename(BACKUP_DIR));
log('');
log('NEXT STEPS:');
log('  git add -A');
log('  git commit -m "Patch 40: chatbot logo + personalized greeting"');
log('  git push');
log('');
log('Then, in a fresh incognito window:');
log('  - Signed OUT (e.g. landing page): greeting stays "Hi there!..."');
log('  - Signed IN (dashboard): greeting becomes "Hi <FirstName>! Welcome back..."');
log('  - The chat header now shows the TapMyCar logo in a white circle.');
log('');
