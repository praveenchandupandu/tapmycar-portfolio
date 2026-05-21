// ============================================================================
// TapMyCar - Patch 35d-renew-fix: Fix p35dStartRenew placement
//
// Bug: Patch 35d-renew inserted the p35dStartRenew() function before the
// "last </script>" in dashboard.html. But that last </script> belongs to:
//
//     <script src="/app-settings.js" defer></script>
//
// A <script> tag WITH a src attribute ignores any inline content between
// its tags. So p35dStartRenew ended up inside a tag the browser never
// executes -> "p35dStartRenew is not defined" when the Subscribe button
// is clicked.
//
// Fix:
//   1. Remove the misplaced function (it sits wrapped in/near the
//      app-settings.js external script tag).
//   2. Re-insert it into the REAL inline app script - the block that ends
//      with "loadDashboard(); registerPush(); </script>" - where every
//      other dashboard function lives and actually executes.
//
// One file: public/dashboard.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35drenewfix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
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
log('TapMyCar Patch 35d-renew-fix \u2014 fix p35dStartRenew placement');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35DRENEWFIX_PLACEMENT';

const file = path.join(PUBLIC, 'dashboard.html');
let content = readFile(file);

if (content.includes(MARKER)) {
  skip('dashboard.html (already patched)');
  process.exit(0);
}
backup(file);

/* ----------------------------------------------------------------------
   Step 1: locate and CUT OUT the existing p35dStartRenew function block,
   wherever Patch 35d-renew put it. We match from the comment header to
   the function's closing brace + newline.
   ---------------------------------------------------------------------- */

const FN_START = '/* TMC_PATCH35DRENEW_GIFT_RENEWAL: start the renewal checkout (annual fee only). */';
const fnStartIdx = content.indexOf(FN_START);

if (fnStartIdx === -1) {
  errExit('Could not find the p35dStartRenew function block. Was Patch 35d-renew applied?');
}

/* Find the end of the function: from FN_START, find "async function
   p35dStartRenew()" then the matching closing brace. Simplest robust way:
   the function ends with a line "}" at column 0 followed by a newline,
   after the last "}" of the try/catch. We brace-count from the function
   keyword. */
const fnKeyword = content.indexOf('async function p35dStartRenew', fnStartIdx);
if (fnKeyword === -1) errExit('p35dStartRenew function keyword not found');

/* brace count from the first { after the keyword */
let i = content.indexOf('{', fnKeyword);
if (i === -1) errExit('opening brace of p35dStartRenew not found');
let depth = 0;
let endIdx = -1;
for (; i < content.length; i++) {
  const ch = content[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { endIdx = i + 1; break; }
  }
}
if (endIdx === -1) errExit('could not find end of p35dStartRenew function');

/* Cut from FN_START to endIdx (plus any trailing whitespace/newline). */
let after = endIdx;
while (after < content.length && (content[after] === '\n' || content[after] === '\r' || content[after] === ' ' || content[after] === '\t')) {
  after++;
}
const removedBlock = content.slice(fnStartIdx, endIdx);
content = content.slice(0, fnStartIdx) + content.slice(after);
ok('Removed misplaced p35dStartRenew block (' + removedBlock.length + ' chars)');

/* ----------------------------------------------------------------------
   Step 2: re-insert the function into the REAL inline app script, right
   before the "</script>" that follows "registerPush();".
   ---------------------------------------------------------------------- */

const reinsertFn = `
/* ${MARKER}: p35dStartRenew \u2014 placed inside the executing inline script. */
async function p35dStartRenew() {
  var btn = document.getElementById('gift-renew-btn');
  var session = (typeof getSession === 'function') ? getSession() : null;
  var token = session && session.token ? session.token : (localStorage.getItem('tmc_token') || '');
  if (!token) { window.location.href = '/signin.html'; return; }
  var plan = window.__tmcRenewPlan || 'standard';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    var res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: token, flow: 'renew', plan: plan })
    });
    var data = await res.json();
    if (data && data.url) {
      window.location.href = data.url;
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe now'; }
    alert((data && data.error) || 'Could not start checkout. Please try again.');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe now'; }
    alert('Network error. Please try again.');
  }
}
`;

/* Anchor: handle both CRLF and LF. */
const anchorLF = 'loadDashboard();\nregisterPush();\n</script>';
const anchorCRLF = 'loadDashboard();\r\nregisterPush();\r\n</script>';

let inserted = false;
if (content.includes(anchorCRLF)) {
  const fnCRLF = reinsertFn.replace(/\n/g, '\r\n');
  content = content.replace(anchorCRLF, () =>
    'loadDashboard();\r\nregisterPush();\r\n' + fnCRLF + '\r\n</script>');
  inserted = true;
} else if (content.includes(anchorLF)) {
  content = content.replace(anchorLF, () =>
    'loadDashboard();\nregisterPush();\n' + reinsertFn + '\n</script>');
  inserted = true;
}
if (!inserted) {
  errExit('Could not find the loadDashboard/registerPush </script> anchor for re-insertion');
}
ok('Re-inserted p35dStartRenew into the executing inline app script');

writeFile(file, content);

/* ----------------------------------------------------------------------
   Verify: the function must now sit BEFORE the app-settings.js external
   tag, inside an inline <script> block.
   ---------------------------------------------------------------------- */
const verify = readFile(file);
const fnPos = verify.indexOf('async function p35dStartRenew');
const appSettingsPos = verify.indexOf('app-settings.js');
const registerPushPos = verify.indexOf('registerPush();');

if (fnPos === -1) errExit('p35dStartRenew missing after re-insertion');
if (appSettingsPos !== -1 && fnPos > appSettingsPos) {
  errExit('p35dStartRenew is still after app-settings.js \u2014 placement still wrong');
}
if (registerPushPos === -1 || fnPos < registerPushPos) {
  errExit('p35dStartRenew is not positioned after registerPush \u2014 unexpected');
}
if ((verify.match(/async function p35dStartRenew/g) || []).length !== 1) {
  errExit('p35dStartRenew appears more than once \u2014 duplicate, aborting');
}
ok('Verified: p35dStartRenew is now inside the executing inline script');

log('');
log('==============================================================');
log('Patch 35d-renew-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35d-renew-fix: fix p35dStartRenew placement"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. Open https://tapmycar.io/dashboard.html in a fresh incognito tab,');
log('     sign in as the gift test user.');
log('  2. In the Console, type:  typeof p35dStartRenew');
log('     Expected: "function"  (was "undefined" before this fix)');
log('  3. Click "Subscribe now" on the gift banner.');
log('  4. Stripe Checkout should open. Confirm it shows ONLY the annual');
log('     price (no sticker fee, no shipping form).');
log('==============================================================');
