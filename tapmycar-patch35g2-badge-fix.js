// ============================================================================
// TapMyCar - Patch 35g-2: Dashboard plan badge for expired gift users
//
// Follow-up to Patch 35g. 35g fixed the vehicle-card status PILL and the
// manage-page plan box. But the dashboard ALSO has a separate "plan badge"
// near the top (id="plan-badge", set at line ~321 from _userPlan).
//
// After a gift trial expires the user's plan is 'etag', so the badge shows
// "Free" - same root issue: an expired Standard gift looks like a free
// eTag user.
//
// Fix: same approach as 35g used for manage.html. If the user has a tag
// with gift_expired = true, show the real gift plan name on the badge
// (e.g. "Standard") instead of "Free". This keeps the dashboard badge,
// the manage-page plan box, and the vehicle-card pill all consistent.
//
// One file: public/dashboard.html. Idempotent, safeReplace, backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35g2-${ts}`);

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
log('TapMyCar Patch 35g-2 \u2014 dashboard plan badge for expired gift users');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35G2_BADGE_FIX';

const file = path.join(PUBLIC, 'dashboard.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('dashboard.html (already patched)');
  process.exit(0);
}
backup(file);

const oldBadge = `    var _planLabels = { etag: 'Free', free: 'Free', standard: 'Standard', premium: 'Premium', business: 'Business' };
    var _badge = document.getElementById('plan-badge');
    if (_badge) _badge.textContent = _planLabels[_userPlan] || _userPlan.charAt(0).toUpperCase() + _userPlan.slice(1);`;

const newBadge = `    var _planLabels = { etag: 'Free', free: 'Free', standard: 'Standard', premium: 'Premium', business: 'Business' };

    /* ${MARKER}: if the user has an expired gift tag, the badge should
       show the real gift plan (e.g. "Standard"), not "Free". The user's
       plan column is 'etag' after expiry, but the tag still carries
       gift_expired + gift_plan. */
    var _giftExpiredTag = null;
    if (data && data.tags && data.tags.length) {
      for (var _gx = 0; _gx < data.tags.length; _gx++) {
        if (data.tags[_gx] && data.tags[_gx].gift_expired === true) {
          _giftExpiredTag = data.tags[_gx];
          break;
        }
      }
    }

    var _badge = document.getElementById('plan-badge');
    if (_badge) {
      if (_giftExpiredTag) {
        var _gxPlan = (_giftExpiredTag.gift_plan || 'standard');
        _badge.textContent = _planLabels[_gxPlan] || (_gxPlan.charAt(0).toUpperCase() + _gxPlan.slice(1));
      } else {
        _badge.textContent = _planLabels[_userPlan] || (_userPlan.charAt(0).toUpperCase() + _userPlan.slice(1));
      }
    }`;

const r = safeReplace(content, oldBadge, newBadge);
if (!r) errExit('dashboard.html: plan-badge anchor not found');

writeFile(file, r);

const verify = readFile(file);
if (!verify.includes(MARKER)) errExit('marker missing after write');
if (!verify.includes('_giftExpiredTag')) errExit('gift-expired detection not added');
ok('dashboard.html: plan badge now shows the real plan for expired gift users');

log('');
log('==============================================================');
log('Patch 35g-2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35g-2: dashboard plan badge for expired gift users"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test:');
log('  Fresh incognito -> dashboard, gift test user (still expired state).');
log('  The plan badge near the top should now read "Standard" \u2014 not');
log('  "Free". After a successful renewal it stays "Standard" normally.');
log('==============================================================');
