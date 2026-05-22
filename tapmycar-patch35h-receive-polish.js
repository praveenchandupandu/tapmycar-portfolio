// ============================================================================
// TapMyCar - Patch 35h: Receive-tab UX polish
//
// The admin "Receive & Verify" tab has two problems:
//
//  PROBLEM 1 - text-named batches do not load
//    loadBatchForVerify() does parseInt() on the batch value. Batch names
//    are TEXT (Patch 21). parseInt("Testbatch1") -> NaN -> the function
//    bails, so text-named batches cannot be opened. (This is the old
//    Patch 35e fix; it was never deployed, so it is folded in here.)
//
//  PROBLEM 2 - confusing "already verified" picture
//    The batch dropdown shows "Batch X (15 tokens)" and the summary shows
//    only Total / Scanned / Not-yet-scanned. Nothing shows how many tokens
//    are ALREADY verified. When an admin opens a batch whose tokens are
//    all already verified (e.g. grandfathered tokens), it looks like 15
//    tokens still need work when really they are all done.
//
// Fixes:
//   1. loadBatchForVerify(): use the raw string batch value, not parseInt.
//   2. loadBatchOptions(): dropdown shows "Batch X - 15 tokens, 12 verified".
//   3. The verify summary gets an "Already verified" stat, set when a
//      batch is opened.
//
// One file: public/admin.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35h-${ts}`);

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
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 35h \u2014 Receive-tab UX polish');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35H_RECEIVE_POLISH';

const file = path.join(PUBLIC, 'admin.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('admin.html (already patched)');
  process.exit(0);
}
backup(file);

let updated = content;

// =============================================================================
// FIX 1 - parseInt -> raw string in loadBatchForVerify
// =============================================================================

const oldParse = `function loadBatchForVerify() {
  const batchNum = parseInt(document.getElementById('verify-batch').value);
  if (!batchNum) {`;
const newParse = `function loadBatchForVerify() {
  /* ${MARKER}: batch names are TEXT (Patch 21). parseInt broke text-named
     batches (parseInt -> NaN -> bailed). Use the raw string value. */
  const batchNum = (document.getElementById('verify-batch').value || '').trim();
  if (!batchNum) {`;

let r = safeReplace(updated, oldParse, newParse);
if (r) {
  updated = r;
  ok('loadBatchForVerify: text-named batches now load (parseInt removed)');
} else {
  /* maybe Patch 35e already deployed - check */
  if (updated.includes("(document.getElementById('verify-batch').value || '').trim()")) {
    ok('loadBatchForVerify: parseInt fix already present (Patch 35e) \u2014 ok');
  } else {
    errExit('admin.html: loadBatchForVerify anchor not found');
  }
}

// =============================================================================
// FIX 2 - dropdown shows verified count
// =============================================================================

const oldOpt = `  }).forEach(b => {
    const count = batchTokensMap[b].length;
    sel.innerHTML += \`<option value="\${b}">Batch \${b} (\${count} tokens)</option>\`;
  });`;
const newOpt = `  }).forEach(b => {
    /* ${MARKER}: show how many in the batch are already verified */
    const _toks = batchTokensMap[b];
    const count = _toks.length;
    const verifiedCount = _toks.filter(function(t){ return t && t.verified === true; }).length;
    sel.innerHTML += \`<option value="\${b}">Batch \${b} \\u2014 \${count} tokens, \${verifiedCount} verified</option>\`;
  });`;

r = safeReplace(updated, oldOpt, newOpt);
if (!r) errExit('admin.html: loadBatchOptions dropdown anchor not found');
updated = r;
ok('batch dropdown now shows verified count per batch');

// =============================================================================
// FIX 3 - add an "Already verified" stat to the verify summary
// =============================================================================

const oldSummary = `    <div class="verify-summary" id="verify-summary" style="display:none">
      <div class="verify-stat"><span class="verify-label">Batch total</span><span class="verify-val" id="v-total">0</span></div>
      <div class="verify-stat"><span class="verify-label">Scanned (received)</span><span class="verify-val green" id="v-scanned">0</span></div>
      <div class="verify-stat"><span class="verify-label">Not yet scanned</span><span class="verify-val yellow" id="v-remaining">0</span></div>
    </div>`;
const newSummary = `    <div class="verify-summary" id="verify-summary" style="display:none">
      <div class="verify-stat"><span class="verify-label">Batch total</span><span class="verify-val" id="v-total">0</span></div>
      <!-- ${MARKER}: already-verified stat -->
      <div class="verify-stat"><span class="verify-label">Already verified</span><span class="verify-val green" id="v-already">0</span></div>
      <div class="verify-stat"><span class="verify-label">Scanned this session</span><span class="verify-val green" id="v-scanned">0</span></div>
      <div class="verify-stat"><span class="verify-label">Not yet scanned</span><span class="verify-val yellow" id="v-remaining">0</span></div>
    </div>`;

r = safeReplace(updated, oldSummary, newSummary);
if (!r) errExit('admin.html: verify-summary anchor not found');
updated = r;
ok('verify summary: added "Already verified" stat');

// =============================================================================
// FIX 3b - populate v-already when a batch is opened
// =============================================================================

const oldLoad = `  const tokens = batchTokensMap[batchNum] || [];
  document.getElementById('verify-summary').style.display = 'block';
  document.getElementById('v-total').textContent = tokens.length;
  document.getElementById('v-scanned').textContent = '0';
  document.getElementById('v-remaining').textContent = tokens.length;`;
const newLoad = `  const tokens = batchTokensMap[batchNum] || [];
  document.getElementById('verify-summary').style.display = 'block';
  document.getElementById('v-total').textContent = tokens.length;
  /* ${MARKER}: how many are already verified */
  var _alreadyVerified = tokens.filter(function(t){ return t && t.verified === true; }).length;
  var _alreadyEl = document.getElementById('v-already');
  if (_alreadyEl) _alreadyEl.textContent = _alreadyVerified;
  document.getElementById('v-scanned').textContent = '0';
  document.getElementById('v-remaining').textContent = tokens.length;`;

r = safeReplace(updated, oldLoad, newLoad);
if (!r) errExit('admin.html: loadBatchForVerify summary-populate anchor not found');
updated = r;
ok('loadBatchForVerify: populates the Already-verified stat');

writeFile(file, updated);

const verify = readFile(file);
const markerCount = (verify.match(/TMC_PATCH35H_RECEIVE_POLISH/g) || []).length;
if (markerCount < 3) errExit('marker count too low after write (' + markerCount + ')');
ok('admin.html written and verified (' + markerCount + ' markers)');

log('');
log('==============================================================');
log('Patch 35h complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35h: Receive-tab UX polish"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  1. admin.html -> Receive tab.');
log('  2. The batch dropdown now reads e.g. "Batch 25 \u2014 30 tokens,');
log('     30 verified" \u2014 so you see at a glance which batches are done.');
log('  3. Pick a text-named batch (e.g. Testbatch1) \u2014 it now loads');
log('     (before, parseInt made text batches fail silently).');
log('  4. The summary shows a new "Already verified" row, so a batch whose');
log('     tokens are all verified no longer looks like unfinished work.');
log('==============================================================');
