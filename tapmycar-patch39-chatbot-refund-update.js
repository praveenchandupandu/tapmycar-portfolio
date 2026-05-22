// ============================================================================
// TapMyCar - Patch 39: Update chatbot's refund-policy knowledge
//
// WHY
//   The chatbot's knowledge lives in a "system prompt" inside api/chat.js.
//   The refund policy in that prompt was outdated - it said "full refunds
//   within 30 days, no questions asked, email support". The CURRENT policy
//   (verified from terms.html / pricing.html / payment-success.html) is:
//     - Refund window is 14 days, and a $1 service fee is retained.
//     - After 14 days the plan is non-refundable; user can still cancel
//       to stop future renewals.
//     - Physical stickers are non-refundable once shipped.
//     - Annual fees: refundable within 14 days of each annual charge
//       ($1 fee retained).
//     - Activation fees, sticker fees and prepaid bundle extras are
//       non-refundable.
//     - Refunds are SELF-SERVE: when eligible, a "Refund $X available"
//       option appears on the Settings page. No email needed.
//
// WHAT THIS PATCH DOES
//   1. api/chat.js  - replaces the single outdated "Refund:" line in the
//      system prompt with an accurate, detailed refund section.
//   2. public/app.js - updates the offline keyword fallback's refund reply
//      so it matches (used only if the AI is ever unreachable).
//   3. Refreshes the old comment block in app.js so it's not misleading.
//   4. Syncs public/app.js -> root app.js.
//
// Properties: idempotent, validates JS, backs up changed files.
// NOTE: This patch does NOT change any actual refund logic, pricing, or
//       the Settings page - it only updates what the CHATBOT says.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch39-${ts}`);

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

// Replace exactly one occurrence of `find` with `replace`. Uses a function
// replacer so PowerShell-style $ sequences in the replacement are literal.
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor text not found - file differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor text appears more than once - cannot safely patch.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 39 - Update chatbot refund-policy knowledge');
log('==========================================================');

// ----------------------------------------------------------------------------
// STEP 1 - api/chat.js : update the refund line in the system prompt
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/chat.js (AI system prompt)');

const chatPath = path.join(API, 'chat.js');
let chatSrc = readFile(chatPath);

const PROMPT_OLD =
  '- Refund: TapMyCar offers refunds within 30 days. Refund STATUS or processing needs account access - have them email support@tapmycar.io with their account email.';

// Plain hyphens / no special chars - safe inside the JS template literal.
const PROMPT_NEW =
  '- Refunds (current policy): A subscription plan can be refunded within 14 days of purchase, and a $1 service fee is retained from the refund. After 14 days the plan is non-refundable, but the user can still cancel anytime to stop future renewals. Annual subscription fees are refundable within 14 days of each annual charge (again, $1 service fee retained). Activation fees, physical sticker fees, and prepaid bundle extras are non-refundable. Physical stickers cannot be refunded once shipped, because each one is uniquely coded to the account. Refunds are SELF-SERVE: when a refund is available, a "Refund $X available" option shows up on the Settings page (tapmycar.io/settings) - the user just cancels there and the refund goes back to their card automatically. They do NOT need to email anyone. Only suggest emailing support@tapmycar.io if the user says the self-serve refund is not appearing or seems wrong.';

if (chatSrc.indexOf('TMC_PATCH39') !== -1) {
  skip('api/chat.js refund text already updated');
} else if (chatSrc.indexOf(PROMPT_NEW.slice(0, 60)) !== -1) {
  skip('api/chat.js refund text already updated');
} else {
  if (chatSrc.indexOf('TMC_PATCH38_CHAT_GEMINI') === -1 &&
      chatSrc.indexOf('TMC_PATCH37_CHAT') === -1) {
    errExit('api/chat.js is not the expected chatbot backend - run Patch 38 first.');
  }
  backup(chatPath, 'api/chat.js');
  chatSrc = replaceOnce(chatSrc, PROMPT_OLD, PROMPT_NEW, 'api/chat.js prompt');
  // tag the file so re-runs are detected
  chatSrc = chatSrc.replace('module.exports = async function handler',
    '// TMC_PATCH39 - refund policy updated\nmodule.exports = async function handler');
  writeFile(chatPath, chatSrc);
  ok('Updated refund policy in the AI system prompt');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/app.js : update offline fallback + stale comment block
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/app.js (offline fallback)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = readFile(appPath);

let appChanged = false;

// 2a - the offline keyword reply
const FALLBACK_OLD =
  "    return 'We offer full refunds within 30 days, no questions asked. Just email support@tapmycar.io with your account email and we\\'ll process it right away.';";
const FALLBACK_NEW =
  "    return 'You can request a refund within 14 days of purchase - a $1 service fee is kept. Just open the Settings page and cancel: if you\\'re within the window, a \"Refund available\" option appears and the refund goes back to your card automatically. Note: activation fees and shipped stickers are non-refundable.';";

if (appSrc.indexOf(FALLBACK_NEW.slice(0, 50)) !== -1) {
  skip('app.js offline refund reply already updated');
} else if (appSrc.indexOf(FALLBACK_OLD) !== -1) {
  appSrc = replaceOnce(appSrc, FALLBACK_OLD, FALLBACK_NEW, 'app.js fallback');
  appChanged = true;
  ok('Updated offline refund reply');
} else {
  log('  \u00b7 offline refund reply not found in expected form - left unchanged');
}

// 2b - the stale comment line in the COMMON ISSUES comment block
const COMMENT_OLD = '- Want a refund  Email support@tapmycar.io, refunds within 30 days';
const COMMENT_NEW = '- Want a refund  Self-serve on the Settings page within 14 days ($1 fee retained)';
if (appSrc.indexOf(COMMENT_NEW) !== -1) {
  skip('app.js comment block already updated');
} else if (appSrc.indexOf(COMMENT_OLD) !== -1) {
  appSrc = appSrc.replace(COMMENT_OLD, function () { return COMMENT_NEW; });
  appChanged = true;
  ok('Refreshed the stale refund comment');
} else {
  log('  \u00b7 stale refund comment not found - left unchanged');
}

if (appChanged) {
  backup(appPath, 'public/app.js');
  writeFile(appPath, appSrc);
}

// ----------------------------------------------------------------------------
// STEP 3 - sync public/app.js -> root app.js
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync to root app.js');
const rootAppPath = path.join(ROOT, 'app.js');
if (fs.existsSync(rootAppPath)) {
  const rootSrc = readFile(rootAppPath);
  if (rootSrc === appSrc) {
    skip('root app.js already in sync');
  } else {
    backup(rootAppPath, 'app.js');
    writeFile(rootAppPath, appSrc);
    ok('Synced root app.js to match public/app.js');
  }
} else {
  log('  \u00b7 no root app.js found - nothing to sync');
}

// ----------------------------------------------------------------------------
// Validate
// ----------------------------------------------------------------------------
log('');
log('Validation');
try {
  require('child_process').execSync('node -c "' + chatPath + '"');
  ok('api/chat.js syntax OK');
} catch (e) {
  errExit('api/chat.js failed syntax check - restore from backup.');
}
try {
  require('child_process').execSync('node -c "' + appPath + '"');
  ok('public/app.js syntax OK');
} catch (e) {
  errExit('public/app.js failed syntax check - restore from backup.');
}

log('');
log('==========================================================');
log('Patch 39 complete.');
if (fs.existsSync(BACKUP_DIR)) log('Backups saved to: ' + path.basename(BACKUP_DIR));
log('');
log('NEXT STEPS:');
log('  git add -A');
log('  git commit -m "Patch 39: update chatbot refund-policy knowledge"');
log('  git push');
log('');
log('Then wait ~60s and ask the chatbot "what is your refund policy" in a');
log('fresh incognito window - it should now describe the 14-day / $1-fee /');
log('self-serve-in-Settings policy.');
log('');
