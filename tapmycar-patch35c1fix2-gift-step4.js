// ============================================================================
// TapMyCar - Patch 35c-1-fix-2: Gift-aware Step 4 for new users
//
// Bug (from user screenshot): a NEW user claiming a gift tag still sees the
// eTag paid Step 4 screen:
//   - "eTag activation  $1.00"
//   - "Auto-upgrade to Standard on day 30  $9.99"
//   - "Auto-upgrade terms" box + consent checkbox
//   - "Pay $1  activate tag" button (disabled until consent)
//
// For a gift tag none of that applies. The gift covers activation; there
// is no $1 charge, no auto-upgrade, no consent needed.
//
// Patch 35c-1-fix already made the pay BUTTON route to the no-payment
// path for gift tags, but the SCREEN still shows paid copy and the button
// stays disabled (it waits on the consent checkbox the gift flow hides).
//
// Fix: extend the existing showState('step4') hook. When step4 is shown
// AND window._tag.is_gift is true:
//   - replace the order-summary card with a gift summary
//   - hide the auto-upgrade terms / consent box
//   - relabel the button to "Claim my free tag"
//   - enable the button immediately (no consent gate for gifts)
//
// One file: public/contact.html. Idempotent, safeReplace, backup, JS check.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1fix2-${ts}`);

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
log('TapMyCar Patch 35c-1-fix-2 \u2014 gift-aware Step 4 for new users');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1FIX2_GIFT_STEP4';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}
backup(file);

let updated = content;

// =============================================================================
// 1. Wrap the Step 4 order-summary + auto-upgrade box with id hooks so the
//    gift renderer can target them. We add ids to the two blocks.
// =============================================================================

/* The order-summary card */
const oldSummary = `    <div class="card"><div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">Order summary</div><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid #E5E7EB"><div style="font-size:14px;color:#111;font-weight:500">eTag activation</div><div style="font-size:14px;font-weight:700;color:#111">$1.00</div></div><div style="display:flex;justify-content:space-between;padding:8px 0"><div style="font-size:12px;color:#6B7280">Auto-upgrade to Standard on day 30</div><div style="font-size:12px;color:#6B7280">$9.99</div></div></div>`;

const newSummary = `    <div class="card" id="s4-order-summary"><div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">Order summary</div><div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid #E5E7EB"><div style="font-size:14px;color:#111;font-weight:500">eTag activation</div><div style="font-size:14px;font-weight:700;color:#111">$1.00</div></div><div style="display:flex;justify-content:space-between;padding:8px 0"><div style="font-size:12px;color:#6B7280">Auto-upgrade to Standard on day 30</div><div style="font-size:12px;color:#6B7280">$9.99</div></div></div>`;

let r = safeReplace(updated, oldSummary, newSummary);
if (!r) errExit('contact.html: step4 order-summary anchor not found');
updated = r;
ok('Step 4 order-summary card given id s4-order-summary');

/* The auto-upgrade terms box */
const oldTerms = `    <div style="background:#FFF3EC;border:1.5px solid #FF6B00;border-radius:14px;padding:16px">
      <div style="font-size:13px;font-weight:700;color:#9A3800;margin-bottom:8px">Auto-upgrade terms</div>`;

const newTerms = `    <div id="s4-autoupgrade-box" style="background:#FFF3EC;border:1.5px solid #FF6B00;border-radius:14px;padding:16px">
      <div style="font-size:13px;font-weight:700;color:#9A3800;margin-bottom:8px">Auto-upgrade terms</div>`;

r = safeReplace(updated, oldTerms, newTerms);
if (!r) errExit('contact.html: step4 auto-upgrade box anchor not found');
updated = r;
ok('Step 4 auto-upgrade box given id s4-autoupgrade-box');

// =============================================================================
// 2. Extend the existing showState('step4') hook to render the gift variant.
// =============================================================================

const oldHook = `      if (id === 'step4') {
        setTimeout(p34cUpdatePayButtonLabel, 30);
        /* Also auto-enable the pay button for paid users (no need to check
           a consent checkbox — they already agreed via signup). */
        if (p34cIsPaidUser) {
          var btn = document.getElementById('pay-btn');
          if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
        }
      }`;

const newHook = `      if (id === 'step4') {
        setTimeout(p34cUpdatePayButtonLabel, 30);
        /* Also auto-enable the pay button for paid users (no need to check
           a consent checkbox — they already agreed via signup). */
        if (p34cIsPaidUser) {
          var btn = document.getElementById('pay-btn');
          if (btn) { btn.style.opacity = '1'; btn.disabled = false; }
        }
        /* ${MARKER}: gift tag — replace the paid Step 4 with a gift screen. */
        setTimeout(p35c1fix2RenderGiftStep4, 35);
      }`;

r = safeReplace(updated, oldHook, newHook);
if (!r) errExit('contact.html: showState step4 hook anchor not found');
updated = r;
ok('showState step4 hook extended for gift rendering');

// =============================================================================
// 3. Add the gift Step 4 renderer function, right after the showState hook.
// =============================================================================

const oldAfterHook = `loadTag();

let selectedRating = 0;`;

const newAfterHook = `/* ${MARKER}: render the gift variant of Step 4. */
function p35c1fix2RenderGiftStep4() {
  var isGift = !!(window._tag && window._tag.is_gift === true);
  if (!isGift) return;

  var gMonthsRaw = window._tag.gift_months;
  var gMonths = (Number(gMonthsRaw) > 0) ? Number(gMonthsRaw) : 1;
  var gPlanRaw = window._tag.gift_plan || 'standard';
  var gPlan = gPlanRaw.charAt(0).toUpperCase() + gPlanRaw.slice(1);

  /* Replace the order summary with a gift summary */
  var summary = document.getElementById('s4-order-summary');
  if (summary) {
    summary.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">Your gift</div>' +
      '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:.5px solid #E5E7EB">' +
        '<div style="font-size:14px;color:#111;font-weight:500">' + gPlan + ' plan \\u2014 ' + gMonths + '-month trial</div>' +
        '<div style="font-size:14px;font-weight:800;color:#16A34A">FREE</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;padding:8px 0">' +
        '<div style="font-size:12px;color:#6B7280">Physical TapMyCar sticker</div>' +
        '<div style="font-size:12px;color:#6B7280">Included</div>' +
      '</div>';
  }

  /* Hide the auto-upgrade terms box entirely */
  var box = document.getElementById('s4-autoupgrade-box');
  if (box) box.style.display = 'none';

  /* Relabel + enable the button (no consent gate for gifts) */
  var btn = document.getElementById('pay-btn');
  if (btn) {
    btn.textContent = 'Claim my free tag';
    btn.style.opacity = '1';
    btn.disabled = false;
  }

  /* Update the step subtitle */
  try {
    var stepViews = document.querySelectorAll('#state-step4 div[style*="font-size:13px"][style*="color:#6B7280"]');
    if (stepViews && stepViews[0]) {
      stepViews[0].textContent = 'Step 4 of 4  Claim your free gift';
    }
  } catch (e) {}
}

loadTag();

let selectedRating = 0;`;

r = safeReplace(updated, oldAfterHook, newAfterHook);
if (!r) errExit('contact.html: post-hook anchor (loadTag) not found');
updated = r;
ok('p35c1fix2RenderGiftStep4 renderer function added');

writeFile(file, updated);

const verify = readFile(file);
const markerCount = (verify.match(/TMC_PATCH35C1FIX2_GIFT_STEP4/g) || []).length;
if (markerCount < 2) errExit('marker count too low after write (' + markerCount + ')');
ok('contact.html written and verified (' + markerCount + ' markers)');

log('');
log('==============================================================');
log('Patch 35c-1-fix-2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1-fix-2: gift-aware Step 4 for new users"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Test (new user, gift tag, tap path):');
log('  1. Tap a gift sticker (or open /tag/TMC-XXXXXX) as a brand-new');
log('     user, not signed in.');
log('  2. Tap "Activate The Tag" -> Step 1 personal details -> continue');
log('     through vehicle + phone verify.');
log('  3. Step 4 should now show:');
log('       "Your gift"  /  "<Plan> plan - N-month trial   FREE"');
log('       "Physical TapMyCar sticker   Included"');
log('     NO "$1.00", NO auto-upgrade terms box, NO consent checkbox.');
log('  4. Button says "Claim my free tag" and is enabled immediately.');
log('  5. Tapping it claims the tag with no charge; the trial is applied.');
log('==============================================================');
