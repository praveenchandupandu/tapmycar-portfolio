// ============================================================================
// TapMyCar - Patch 63: Fix the chatbot's eTag-duration answer
//
// ROOT CAUSE
//   The chatbot says the eTag "works indefinitely / doesn't expire" - WRONG.
//   The live chatbot brain is api/chat.js (Google Gemini), and its
//   SYSTEM_PROMPT describes the eTag only as "free digital QR code... great
//   for trying TapMyCar" - with NO mention of the 30-day limit. So Gemini
//   fills the gap with a confident hallucination.
//   (Patch 62 edited a DIFFERENT prompt - the unused TMC_SYSTEM_PROMPT in
//   app.js - which is why nothing changed.)
//
// CONFIRMED ETAG RULE (from Praveen)
//   Free eTag = full features, free for 30 days. NO automatic charge ever.
//   Before 30 days end, the user upgrades to Standard or Premium; if they
//   don't, the eTag deactivates. The physical sticker ships after they
//   upgrade to a paid plan.
//
// WHAT THIS PATCH DOES
//   1. api/chat.js - the eTag line in SYSTEM_PROMPT now states the 30-day
//      rule, and a CRITICAL hard-rule block is added that forbids the AI
//      from ever saying the eTag is permanent / unlimited / never expires.
//   2. public/app.js - getSmartResponse() gets a deterministic INTERCEPTOR:
//      any "how long does the eTag last / does it expire" question is
//      answered with a fixed, correct sentence. (getSmartResponse is the
//      offline path, but the interceptor guarantees a correct answer there
//      and the prompt rule covers the online Gemini path.)
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
const BACKUP_DIR = path.join(ROOT, `backup-patch63-${ts}`);

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
log('TapMyCar Patch 63 - Fix chatbot eTag-duration answer');
log('====================================================');

// ----------------------------------------------------------------------------
// STEP 1 - api/chat.js : fix the REAL system prompt
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/chat.js (real Gemini system prompt)');

const chatPath = path.join(API, 'chat.js');
let chatSrc = fs.readFileSync(chatPath, 'utf8');

if (chatSrc.indexOf('TMC_PATCH63_ETAG') !== -1) {
  skip('api/chat.js');
} else {
  backup(chatPath, 'api/chat.js');

  // 1a - replace the vague eTag plan line with the accurate 30-day version.
  chatSrc = replaceOnce(chatSrc,
    '- eTag: free digital QR code, downloadable instantly as a PDF. Great for trying TapMyCar.',
    '- eTag: a free digital QR code, downloadable instantly as a PDF. It is FREE FOR 30 DAYS. ' +
    'Before the 30 days end, the user upgrades to Standard or Premium to keep the tag active; ' +
    'if they do not upgrade, the eTag deactivates. There is NO automatic charge - the user is ' +
    'never billed without choosing to upgrade.',
    'Step 1a eTag plan line');

  // 1b - add a CRITICAL hard-rule block right before the STYLE section.
  chatSrc = replaceOnce(chatSrc,
    'STYLE\n- Be warm, natural, and human.',
    'CRITICAL FACT - THE eTAG IS NOT PERMANENT (TMC_PATCH63_ETAG)\n' +
    'The free eTag works for 30 DAYS only. You must NEVER tell a user the eTag ' +
    'is permanent, lifetime, unlimited, "doesn\'t expire", or "works indefinitely" ' +
    '- that is false. Always state it clearly: the eTag is free for 30 days, after ' +
    'which the user must upgrade to a paid plan (Standard or Premium) to keep the ' +
    'tag active, or it deactivates. There is no automatic charge. The physical ' +
    'sticker ships after the user upgrades to a paid plan. If asked how long the ' +
    'eTag lasts or whether it expires, give exactly this rule.\n\n' +
    'STYLE\n- Be warm, natural, and human.',
    'Step 1b hard-rule block');

  writeFile(chatPath, chatSrc);
  checkJs(chatPath, 'api/chat.js');
  ok('Real chatbot prompt now states the 30-day eTag rule + hard rule');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/app.js : deterministic eTag interceptor in getSmartResponse
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/app.js (offline interceptor)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = fs.readFileSync(appPath, 'utf8');

if (appSrc.indexOf('TMC_PATCH63_ETAG') !== -1) {
  skip('public/app.js');
} else {
  backup(appPath, 'public/app.js');

  // Insert the interceptor right at the top of getSmartResponse's body,
  // before any other branch, so eTag-duration questions are caught first.
  const ANCHOR = 'function getSmartResponse(question) {\r\n  const q = question.toLowerCase();\r\n';
  const FIXED_ANSWER =
    'The free eTag works for 30 days. Before the 30 days end, you upgrade to ' +
    'Standard or Premium to keep your tag active - if you do not upgrade, the ' +
    'eTag deactivates. There is no automatic charge, so you are never billed ' +
    'without choosing to. The physical sticker ships once you upgrade to a paid plan.';
  const INTERCEPTOR = ANCHOR +
    '\r\n  // TMC_PATCH63_ETAG: deterministic answer for eTag-duration questions,\r\n' +
    '  // so the bot can never say the eTag is permanent / never expires.\r\n' +
    '  if (q.indexOf("etag") !== -1 || q.indexOf("e-tag") !== -1 ||\r\n' +
    '      (q.indexOf("free") !== -1 && (q.indexOf("tag") !== -1 || q.indexOf("qr") !== -1))) {\r\n' +
    '    if (q.indexOf("how long") !== -1 || q.indexOf("days") !== -1 ||\r\n' +
    '        q.indexOf("expire") !== -1 || q.indexOf("expir") !== -1 ||\r\n' +
    '        q.indexOf("last") !== -1 || q.indexOf("duration") !== -1 ||\r\n' +
    '        q.indexOf("permanent") !== -1 || q.indexOf("forever") !== -1 ||\r\n' +
    '        q.indexOf("indefinit") !== -1 || q.indexOf("30") !== -1) {\r\n' +
    '      return ' + JSON.stringify(FIXED_ANSWER) + ';\r\n' +
    '    }\r\n' +
    '  }\r\n';
  appSrc = replaceOnce(appSrc, ANCHOR, INTERCEPTOR, 'Step 2 interceptor');

  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
  ok('Offline helper now gives a fixed, correct eTag-duration answer');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
const appRoot = path.join(ROOT, 'app.js');
if (fs.existsSync(appRoot)) {
  backup(appRoot, 'root-app.js');
  fs.copyFileSync(appPath, appRoot);
  ok('Synced app.js -> root');
}

log('');
log('====================================================');
log('Patch 63 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh. TEST the chatbot:');
log('   1. Ask "how many days does the eTag work?" -> it must say 30 days,');
log('      upgrade to keep it, deactivates if not, no automatic charge.');
log('   2. Ask "does the eTag expire?" / "is the eTag permanent?" -> it must');
log('      NOT say it is permanent or never expires.');
log('');
log('  Note: the chatbot uses Gemini (api/chat.js). The hard-rule makes it');
log('  reliably correct; the app.js interceptor is the offline safety net.');
log('  Next: Patch 64 - eTag 30-day copy + verification message on the');
log('  pricing / activate / manage / landing pages and Terms & Privacy.');
log('');
