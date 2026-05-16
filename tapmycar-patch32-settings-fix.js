// ============================================================================
// TapMyCar - Patch 32: Fix settings.html corruption from Patch 31
//
// Bug discovered: Patch 31 corrupted public/settings.html. The replacement
// strings contained literal "$'" sequences (inside JS strings like
// 'Refund $' + dollars). When passed to String.prototype.replace() as the
// REPLACEMENT argument, "$'" is a regex special token meaning "the portion
// of the string AFTER the match." So instead of inserting literal "$' +
// dollars + ...", JS expanded "$'" to the entire rest of the file, which
// got injected into the patched content AND then the original deleteAccount
// + everything-after also remained. Result: settings.html grew from ~528
// lines to ~1450 lines, with the cancelSubscription string literal
// truncated mid-way (at "'Refund "), breaking JS parsing on the page.
//
// Symptoms: SMS toggle doesn't save, Cancel button doesn't work, family
// codes box doesn't load, and the bottom of the page shows raw JS source
// because the parser bailed.
//
// Fix strategy: restore settings.html from the Patch 31 backup, then
// re-apply Patch 31's changes using the CORRECT replace technique (passing
// a function as the second arg to replace(), which bypasses $-token parsing
// entirely). This is the same lesson learned earlier in the project; I
// re-introduced the bug in Patch 31 and now we're fixing it once more.
//
// What this patch does:
//   1. Find the most recent backup-patch31-* folder
//   2. Copy backup/public/settings.html over current public/settings.html
//   3. Re-insert Patch 31's three blocks (eligibility helper + adaptive
//      cancelSubscription + onload hook), this time using function-replace
//      so "$'" stays literal
//   4. Validate by checking for duplicate function definitions, balanced
//      script tags, and presence of the markers
//
// Properties: idempotent (if file is already clean and patched, skips).
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch32-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const warn = (s) => console.log('  ! ' + s);
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

// Function-callback replace: bypasses $-token interpretation.
// Use this whenever the replacement contains $' or $& or $1 etc.
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  const replacementFn = () => newStr;
  if (content.includes(oldStr)) return content.replace(oldStr, replacementFn);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 32 \u2014 fix settings.html corruption from Patch 31');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const file = path.join(PUBLIC, 'settings.html');

// ===========================================================================
// 32.1  Detect state and decide what to do
// ===========================================================================

const current = readFile(file);
const lineCount = current.split('\n').length;
const deleteAccountCount = (current.match(/async function deleteAccount\(/g) || []).length;
const patch31MarkerCount = (current.match(/TMC_PATCH31_REFUND/g) || []).length;
const truncatedStringPresent = current.includes("sub.textContent = 'Refund \n");
const patch32MarkerPresent = current.includes('TMC_PATCH32_REFUND_FIX');

log('Current state:');
log('  lines: ' + lineCount);
log('  deleteAccount definitions: ' + deleteAccountCount + ' (should be 1)');
log('  TMC_PATCH31_REFUND markers: ' + patch31MarkerCount);
log('  truncated "Refund \\n" string present: ' + truncatedStringPresent);
log('  TMC_PATCH32 marker present: ' + patch32MarkerPresent);
log('');

if (patch32MarkerPresent) {
  log('  \u00b7 Already patched by Patch 32, skipping.');
  process.exit(0);
}

const isCorrupted = truncatedStringPresent || deleteAccountCount > 1 || lineCount > 700;

let working;
if (isCorrupted) {
  log('Settings.html is corrupted. Restoring from Patch 31 backup\u2026');
  // Find newest backup-patch31-* folder
  const backupDirs = fs.readdirSync(ROOT).filter(d => d.startsWith('backup-patch31-')).sort();
  if (backupDirs.length === 0) {
    errExit('No backup-patch31-* folder found. Cannot recover settings.html automatically.\n  Manual recovery: git checkout HEAD~N -- public/settings.html (where N is patches since Patch 31)');
  }
  const backupSrc = path.join(ROOT, backupDirs[backupDirs.length - 1], 'public', 'settings.html');
  if (!fs.existsSync(backupSrc)) {
    errExit('Latest backup folder exists but settings.html missing inside: ' + backupSrc);
  }
  log('  Using backup: ' + backupDirs[backupDirs.length - 1]);
  working = readFile(backupSrc);
  const wLines = working.split('\n').length;
  const wDelCount = (working.match(/async function deleteAccount\(/g) || []).length;
  if (wDelCount !== 1) errExit('Backup also corrupted (deleteAccount count: ' + wDelCount + '). Aborting.');
  log('  Backup is clean (' + wLines + ' lines, 1 deleteAccount).');
  backup(file); // save the corrupted version before overwriting
  ok('Restored settings.html from backup');
} else {
  log('Settings.html appears not corrupted. Will apply Patch 31 changes directly.');
  backup(file);
  working = current;
}

// ===========================================================================
// 32.2  Re-apply Patch 31's three blocks using safeReplace (function-callback)
// ===========================================================================

log('');
log('Re-applying Patch 31 refund-flow changes safely\u2026');

const MARKER_32 = 'TMC_PATCH32_REFUND_FIX';
const MARKER_31 = 'TMC_PATCH31_REFUND';

// Block 1 — replace the original cancelSubscription function with the
// refund-aware version. Anchor is the EXACT original function from before
// Patch 31 ran (because we restored from backup).
const anchor1 = `async function cancelSubscription() {
  if (!confirm('Cancel your TapMyCar subscription?\\n\\nYou will not be charged again. Your tag will stay active until the end of your current paid period.\\n\\nPhysical stickers already shipped are yours to keep.')) return;
  try {
    const res = await fetch('/api/cancel-subscription', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user_id: s.token }) });
    const data = await res.json();
    if (data.success) { showToast('Subscription cancelled'); document.getElementById('cancel-sub-row').style.display = 'none'; }
    else { showToast(data.error || 'Failed to cancel'); }
  } catch(e) { showToast('Network error'); }
}`;

const replacement1 = `/* ${MARKER_31}: refund-aware cancel (fixed in ${MARKER_32}) */
let _p31Elig = null;

async function _p31LoadEligibility() {
  try {
    const r = await fetch('/api/cancel-subscription-preview?user_id=' + encodeURIComponent(s.token));
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.success) return null;
    _p31Elig = data;
    const sub = document.querySelector('#cancel-sub-row .set-s');
    if (sub && data.eligible && data.refund_cents > 0) {
      const dollars = (data.refund_cents / 100).toFixed(2);
      sub.textContent = 'Refund $' + dollars + ' available (within 14 days)';
    }
    return data;
  } catch (e) { return null; }
}

async function cancelSubscription() {
  await _p31LoadEligibility();

  let confirmed = false;
  if (_p31Elig && _p31Elig.eligible && _p31Elig.refund_cents > 0) {
    const dollars = (_p31Elig.refund_cents / 100).toFixed(2);
    confirmed = confirm(
      'Cancel and refund $' + dollars + '?\\n\\n' +
      'You paid your annual subscription within the last 14 days, so we will refund $' + dollars + ' to your card now.\\n' +
      '($1 service fee retained per refund policy.)\\n\\n' +
      'After the refund:\\n' +
      '\u2022 Your subscription stops immediately\\n' +
      '\u2022 Your tag becomes inactive\\n' +
      '\u2022 Physical stickers you have are yours to keep\\n' +
      '\u2022 You can re-subscribe anytime\\n\\n' +
      'Refund arrives in 3-5 business days.'
    );
  } else {
    confirmed = confirm(
      'Cancel your TapMyCar subscription?\\n\\n' +
      'You will not be charged again. Your tag stays active until the end of your current paid period.\\n\\n' +
      'Physical stickers already shipped are yours to keep.\\n\\n' +
      'Note: refunds are only available within 14 days of an annual charge.'
    );
  }
  if (!confirmed) return;

  try {
    const res = await fetch('/api/cancel-subscription', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token })
    });
    const data = await res.json();
    if (data.success) {
      if (data.refund_issued && data.refund_amount_cents > 0) {
        const d = (data.refund_amount_cents / 100).toFixed(2);
        showToast('Canceled. Refund of $' + d + ' on its way.');
      } else {
        showToast('Subscription canceled');
      }
      document.getElementById('cancel-sub-row').style.display = 'none';
    } else {
      showToast(data.error || 'Failed to cancel');
    }
  } catch(e) {
    showToast('Network error');
  }
}

/* ${MARKER_32}: load eligibility shortly after page mount */
(function() {
  function _kick() { try { _p31LoadEligibility(); } catch(e) {} }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_kick, 800); });
  } else {
    setTimeout(_kick, 800);
  }
})();`;

const r1 = safeReplace(working, anchor1, replacement1);
if (!r1) errExit('settings.html: cancelSubscription anchor not found in working copy');
working = r1;
ok('Inserted refund-aware cancelSubscription + helpers');

// ===========================================================================
// 32.3  Write file and verify
// ===========================================================================

writeFile(file, working);

const finalContent = readFile(file);
const finalLines = finalContent.split('\n').length;
const finalDelCount = (finalContent.match(/async function deleteAccount\(/g) || []).length;
const finalMarker32 = finalContent.includes(MARKER_32);
const finalMarker31 = (finalContent.match(/TMC_PATCH31_REFUND/g) || []).length;
const finalTruncated = finalContent.includes("sub.textContent = 'Refund \n");
const finalScriptOpen = (finalContent.match(/<script/g) || []).length;
const finalScriptClose = (finalContent.match(/<\/script>/g) || []).length;

log('');
log('Verification:');
log('  final lines: ' + finalLines);
log('  deleteAccount count: ' + finalDelCount + ' (must be 1)');
log('  TMC_PATCH31 markers: ' + finalMarker31 + ' (>=1 expected)');
log('  TMC_PATCH32 marker present: ' + finalMarker32);
log('  truncated "Refund \\n" gone: ' + !finalTruncated);
log('  <script tags balanced: ' + (finalScriptOpen === finalScriptClose) + ' (' + finalScriptOpen + '/' + finalScriptClose + ')');

if (finalDelCount !== 1) errExit('deleteAccount count is wrong (' + finalDelCount + '); aborting');
if (!finalMarker32) errExit('Patch 32 marker missing; aborting');
if (finalTruncated) errExit('Truncated string still present; aborting');
if (finalScriptOpen !== finalScriptClose) errExit('Script tags unbalanced; aborting');

ok('settings.html restored and re-patched successfully');

log('');
log('==============================================================');
log('Patch 32 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 32: fix settings.html corruption from Patch 31"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test after deploy:');
log('  1. Hard refresh tapmycar.io/settings.html in fresh incognito.');
log('  2. Page should render normally \u2014 no raw JS code visible at the bottom.');
log('  3. SMS toggle should respond to clicks.');
log('  4. Family codes box should load (or show "no codes" depending on plan).');
log('  5. If you have an active subscription within 14 days of an annual');
log('     charge, the Cancel row subtitle should say:');
log('     "Refund $X.XX available (within 14 days)"');
log('==============================================================');
