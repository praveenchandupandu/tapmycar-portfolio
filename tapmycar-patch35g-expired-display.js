// ============================================================================
// TapMyCar - Patch 35g: Correct status + plan display for expired gift tags
//
// Two display bugs after a gift trial expires (tag -> inactive, user ->
// plan 'etag'):
//
//  BUG 1 - dashboard.html
//    The vehicle card shows a hardcoded green "Active" pill (line ~110)
//    that JS never updates. The status handler (line ~360) only handles
//    'paused', not 'inactive'. So an inactive tag still looks Active.
//    Fix: give the pill an id, and add an 'inactive' branch that sets the
//    pill to "Inactive" (amber) and the ON/OFF stat to "OFF".
//
//  BUG 2 - manage.html
//    The plan box shows planNames[user.plan]. After a gift trial expires
//    the user's plan is 'etag', so it shows "eTag (Free)" - hiding that
//    this was a Standard (or Premium) gift tag that is just paused.
//    Fix: if the user's gift tag has gift_expired = true, show the real
//    gift plan name with a "Trial ended - reactivate to continue" note,
//    instead of "eTag (Free)".
//
// Files: public/dashboard.html, public/manage.html.
// Idempotent, safeReplace, per-file backup, verify.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35g-${ts}`);

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
log('TapMyCar Patch 35g \u2014 status + plan display for expired gift tags');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35G_EXPIRED_DISPLAY';

// =============================================================================
// BUG 1 - dashboard.html
// =============================================================================

log('Part 1  public/dashboard.html: vehicle card status badge');
{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('dashboard.html');
  } else {
    backup(file);
    let updated = content;

    /* 1a: give the hardcoded "Active" pill an id */
    const oldPill = `        <span class="sp sp-on">Active</span>`;
    const newPill = `        <span class="sp sp-on" id="tag-status-pill">Active</span>`;
    let r = safeReplace(updated, oldPill, newPill);
    if (!r) errExit('dashboard.html: status pill anchor not found');
    updated = r;
    ok('vehicle card status pill given id tag-status-pill');

    /* 1b: extend the status handler - add an 'inactive' branch */
    const oldHandler = `      currentTagStatus = tag.status || "active";
      if (currentTagStatus === "paused") {
        document.getElementById("pause-label").textContent = " Resume Tag";
        document.getElementById("pause-sub").textContent = "Tag paused  strangers see nothing";
        document.getElementById("stat-status").textContent = "OFF";
        document.getElementById("stat-status").style.color = "var(--rd,#DC2626)";
      }`;

    const newHandler = `      currentTagStatus = tag.status || "active";
      if (currentTagStatus === "paused") {
        document.getElementById("pause-label").textContent = " Resume Tag";
        document.getElementById("pause-sub").textContent = "Tag paused  strangers see nothing";
        document.getElementById("stat-status").textContent = "OFF";
        document.getElementById("stat-status").style.color = "var(--rd,#DC2626)";
      }
      /* ${MARKER}: reflect inactive / disabled tags on the card + stat */
      if (currentTagStatus === "inactive" || currentTagStatus === "disabled") {
        var _pill = document.getElementById("tag-status-pill");
        if (_pill) {
          _pill.textContent = "Inactive";
          _pill.className = "sp sp-am";
        }
        var _stat = document.getElementById("stat-status");
        if (_stat) {
          _stat.textContent = "OFF";
          _stat.style.color = "var(--rd,#DC2626)";
        }
      }`;

    r = safeReplace(updated, oldHandler, newHandler);
    if (!r) errExit('dashboard.html: status handler anchor not found');
    updated = r;
    ok('status handler now covers inactive / disabled tags');

    writeFile(file, updated);
  }
}

// =============================================================================
// BUG 2 - manage.html
// =============================================================================

log('');
log('Part 2  public/manage.html: expired-gift plan label');
{
  const file = path.join(PUBLIC, 'manage.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('manage.html');
  } else {
    backup(file);

    /* Replace the plan-name + description lines so an expired gift tag
       shows its real plan + a "trial ended" note instead of "eTag (Free)". */
    const oldPlanBlock = `    let planHTML = '<div class="plan-card current" style="margin-bottom:14px">';
    planHTML += '<div class="plan-badge" style="background:var(--or);color:#fff">Your Current Plan</div>';
    planHTML += '<div class="plan-name">' + (planNames[userPlan] || userPlan) + '</div>';
    if (userPlan === 'etag') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">Free digital QR tag</div>';
    else if (userPlan === 'standard') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">Physical sticker + masked calling + scan location</div>';
    else if (userPlan === 'premium') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">3 vehicles + unlimited calls + full protection</div>';
    planHTML += '</div>';
    document.getElementById('current-plan-box').innerHTML = planHTML;`;

    const newPlanBlock = `    /* ${MARKER}: detect an expired gift tag. The user's plan is 'etag'
       after expiry, but the tag still carries gift_expired + gift_plan,
       so we show the real gift plan with a "trial ended" note. */
    var _giftExpiredTag = null;
    if (data.tags && data.tags.length) {
      for (var _gi = 0; _gi < data.tags.length; _gi++) {
        if (data.tags[_gi] && data.tags[_gi].gift_expired === true) {
          _giftExpiredTag = data.tags[_gi];
          break;
        }
      }
    }

    let planHTML = '<div class="plan-card current" style="margin-bottom:14px">';
    if (_giftExpiredTag) {
      var _gp = (_giftExpiredTag.gift_plan || 'standard');
      var _gpName = planNames[_gp] || (_gp.charAt(0).toUpperCase() + _gp.slice(1));
      planHTML += '<div class="plan-badge" style="background:#DC2626;color:#fff">Trial ended</div>';
      planHTML += '<div class="plan-name">' + _gpName + '</div>';
      planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">Your free trial has ended. Subscribe to reactivate your tag and keep ' + _gpName + ' features.</div>';
    } else {
      planHTML += '<div class="plan-badge" style="background:var(--or);color:#fff">Your Current Plan</div>';
      planHTML += '<div class="plan-name">' + (planNames[userPlan] || userPlan) + '</div>';
      if (userPlan === 'etag') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">Free digital QR tag</div>';
      else if (userPlan === 'standard') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">Physical sticker + masked calling + scan location</div>';
      else if (userPlan === 'premium') planHTML += '<div style="font-size:11px;color:var(--gy);margin-top:4px">3 vehicles + unlimited calls + full protection</div>';
    }
    planHTML += '</div>';
    document.getElementById('current-plan-box').innerHTML = planHTML;`;

    const r = safeReplace(content, oldPlanBlock, newPlanBlock);
    if (!r) errExit('manage.html: plan-box anchor not found');
    writeFile(file, r);
    ok('manage.html: expired gift tags show real plan + trial-ended note');
  }
}

log('');
log('==============================================================');
log('Patch 35g complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35g: correct status + plan display for expired gift tags"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test (with the gift test user still in the expired state):');
log('  1. Fresh incognito -> dashboard. The Subaru card pill should now');
log('     read "Inactive" (amber), and the Status stat should read "OFF".');
log('  2. Open the Manage page. The plan box should show "Standard" with');
log('     a red "Trial ended" badge and a reactivate note \u2014 NOT');
log('     "eTag (Free)".');
log('  3. After a successful renewal the tag goes active again and the');
log('     plan box returns to the normal "Your Current Plan" display.');
log('==============================================================');
