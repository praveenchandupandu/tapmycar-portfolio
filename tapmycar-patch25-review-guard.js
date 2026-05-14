// ============================================================================
// TapMyCar - Patch 25: Guard updateReviewCounts from firing without admin key
//
// Patch 24 guarded p20UpdateBadges (which fetches /api/get-reviews on a
// 30-second loop). But there's a separate auto-firing call from
// updateReviewCounts() — runs 1.5 seconds after window 'load' regardless
// of whether admin signed in. If admin login hasn't completed yet
// (or admin isn't on the page at all), the call sends empty admin_key=
// and the server rejects with 401.
//
// Three call sites in admin.html for updateReviewCounts:
//   1. window.load timer (line ~4042) — fires on every page load
//   2. click on [data-tab="reviews"] — fires when admin opens Reviews tab
//   3. moderate-review success handler — fires after admin approves/rejects
//
// All three can fire when admin key is set or not. Sites 2 and 3 are fine
// because admin must be signed in to reach them. Site 1 is the problem.
//
// Fix: add an admin-key guard inside updateReviewCounts itself. If no
// admin key, skip the fetch entirely.
//
// Properties: idempotent.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch25-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 25 \u2014 guard updateReviewCounts');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_25 = 'TMC_PATCH25_REVIEW_GUARD';

{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);

  if (content.includes(MARKER_25)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);

    const anchor = `async function updateReviewCounts() {
  try {
    const key = encodeURIComponent(getAdminKey());
    const [pendingRes, approvedRes] = await Promise.all([
      fetch('/api/get-reviews?status=pending&limit=200&admin_key=' + key).then(r => r.json()),
      fetch('/api/get-reviews?status=approved&limit=200&admin_key=' + key).then(r => r.json())
    ]);`;

    const replacement = `async function updateReviewCounts() {
  /* ${MARKER_25}: skip when admin not signed in yet */
  const _k = getAdminKey();
  if (!_k) return;
  try {
    const key = encodeURIComponent(_k);
    const [pendingRes, approvedRes] = await Promise.all([
      fetch('/api/get-reviews?status=pending&limit=200&admin_key=' + key).then(r => r.ok ? r.json() : { reviews: [] }),
      fetch('/api/get-reviews?status=approved&limit=200&admin_key=' + key).then(r => r.ok ? r.json() : { reviews: [] })
    ]);`;

    const r = tryReplace(content, anchor, replacement);
    if (!r) errExit('admin.html: updateReviewCounts anchor not found');

    writeFile(file, r);
    ok('admin.html: updateReviewCounts now guards on admin key');
  }
}

log('');
log('==============================================================');
log('Patch 25 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 25: guard updateReviewCounts from firing without admin key"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test: open admin.html in fresh incognito. Console should be CLEAN.');
log('==============================================================');
