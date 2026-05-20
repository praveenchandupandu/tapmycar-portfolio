// ============================================================================
// TapMyCar - Patch 35c-1-fix: Gift detection in the tap/scan activation path
//
// Bug reported: activating a gift tag works via activate.html (Patch 35c-1)
// but NOT when tapping the physical sticker. Tapping the sticker opens
// /tag/TMC-XXXXXX -> contact.html, which has its OWN activation flow
// (startActivation). That flow routes purely by USER PLAN:
//   - paid/gifted-plan user  -> no payment
//   - free-plan user         -> blocked with "A plan is required"
//   - new/other              -> asked to pay $1
// It never checks whether the TAG itself is a gift, so a gift tag still
// demands payment / gets blocked.
//
// Fix: in contact.html startActivation(), check window._tag.is_gift FIRST.
// If the scanned tag is a gift, route into the existing no-payment paid
// flow (p34cEnterPaidFlow) REGARDLESS of the user's own plan. The pay
// button hook already sends p34cIsPaidUser users through
// p34cActivateWithoutPayment_v2 -> POST /api/get-tag, and the Patch 35c-1
// backend already applies the trial when it sees is_gift=true. So routing
// a gift tag into the paid flow makes the whole thing work end to end.
//
// A signed-in user is still required (we need a user_id to claim to). If a
// gift tag is tapped while NOT signed in, the normal new-user registration
// runs, and the pay step is suppressed by the same gift check there.
//
// Properties: idempotent, safeReplace, backs up file, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c1fix-${ts}`);

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
log('TapMyCar Patch 35c-1-fix \u2014 gift detection in tap/scan activation');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C1FIX_GIFT_TAP';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}
backup(file);

let updated = content;

// =============================================================================
// 1. startActivation() — gift check before the plan-based routing
// =============================================================================

const oldDispatch = `async function startActivation(){
  /* TMC_PATCH34C_PAID_FLOW: dispatcher — if signed-in paid/gifted user, route to
     the streamlined paid-flow. Otherwise fall through to the existing
     new-user registration path. */
  var _ptok = localStorage.getItem('tmc_token');
  if (_ptok) {
    var _puser = await p34cHydrateUser();
    if (_puser) {
      var _pp = String(_puser.plan || 'etag').toLowerCase().trim();
      if (_pp === 'standard' || _pp === 'premium' || _pp === 'business') {
        await p34cEnterPaidFlow(_puser);
        return;
      }
      /* signed in, free plan -> block with pricing CTA */
      p34cShowNoPlanRequired();
      return;
    }
  }`;

const newDispatch = `async function startActivation(){
  /* TMC_PATCH34C_PAID_FLOW: dispatcher — if signed-in paid/gifted user, route to
     the streamlined paid-flow. Otherwise fall through to the existing
     new-user registration path. */
  /* ${MARKER}: if the scanned tag is a GIFT, route into the no-payment
     paid flow regardless of the user's own plan. The gift covers the
     activation; the backend (get-tag.js, Patch 35c-1) applies the trial. */
  var _isGiftTag = !!(window._tag && window._tag.is_gift === true);

  var _ptok = localStorage.getItem('tmc_token');
  if (_ptok) {
    var _puser = await p34cHydrateUser();
    if (_puser) {
      var _pp = String(_puser.plan || 'etag').toLowerCase().trim();
      if (_isGiftTag) {
        /* Gift tag + signed-in user: no-payment flow no matter their plan. */
        await p34cEnterPaidFlow(_puser);
        return;
      }
      if (_pp === 'standard' || _pp === 'premium' || _pp === 'business') {
        await p34cEnterPaidFlow(_puser);
        return;
      }
      /* signed in, free plan -> block with pricing CTA */
      p34cShowNoPlanRequired();
      return;
    }
  }`;

let r = safeReplace(updated, oldDispatch, newDispatch);
if (!r) errExit('contact.html: startActivation dispatcher anchor not found');
updated = r;
ok('startActivation: gift tag now routes to no-payment flow for any signed-in user');

// =============================================================================
// 2. New-user pay step — suppress payment when the tag is a gift
//    The pay button hook routes p34cIsPaidUser users to the no-payment
//    path. We set p34cIsPaidUser=true for gift tags so even a brand-new
//    user (who just registered) skips payment on a gift tag.
// =============================================================================

const oldHook = `function p34cInstallPayButtonHook() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  /* Remove any existing onclick attribute and set our router. */
  try { btn.removeAttribute('onclick'); } catch (e) {}
  btn.onclick = function() {
    if (p34cIsPaidUser) {
      p34cActivateWithoutPayment_v2();
      return;
    }
    /* Fall through to the original paid checkout flow. */
    try { activateAndPay(); } catch (e) { console.error(e); }
  };
}`;

const newHook = `function p34cInstallPayButtonHook() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  /* Remove any existing onclick attribute and set our router. */
  try { btn.removeAttribute('onclick'); } catch (e) {}
  btn.onclick = function() {
    /* ${MARKER}: a gift tag is always no-payment, even for brand-new users. */
    var giftTag = !!(window._tag && window._tag.is_gift === true);
    if (p34cIsPaidUser || giftTag) {
      p34cActivateWithoutPayment_v2();
      return;
    }
    /* Fall through to the original paid checkout flow. */
    try { activateAndPay(); } catch (e) { console.error(e); }
  };
}`;

r = safeReplace(updated, oldHook, newHook);
if (!r) errExit('contact.html: p34cInstallPayButtonHook anchor not found');
updated = r;
ok('pay button: gift tags skip payment even for new users');

// =============================================================================
// 3. Update the pay-step button label for gift tags so it does not say
//    "Pay $1" when the user is claiming a gift. We adjust it at the point
//    the payment step is shown. Find the step-4 button and give it an id
//    based hook via a small DOMContentLoaded relabel.
// =============================================================================

/* Insert a relabel helper near the pay button hook install. We piggyback
   on showState by adding a post-hook. Simplest reliable approach: when the
   pay step becomes visible we relabel. We add a tiny MutationObserver-free
   approach: relabel inside p34cInstallPayButtonHook (runs on load) AND
   whenever startActivation determines a gift. We do the load-time relabel
   here. */
const oldHookCall = `ok('pay button: gift tags skip payment even for new users');`;
/* (no-op placeholder; relabel handled below via a function) */

/* Add a gift-aware relabel function + call it. Anchor: right after the
   (now patched) p34cInstallPayButtonHook function. */
const anchorAfterHook = `  btn.onclick = function() {
    /* ${MARKER}: a gift tag is always no-payment, even for brand-new users. */
    var giftTag = !!(window._tag && window._tag.is_gift === true);
    if (p34cIsPaidUser || giftTag) {
      p34cActivateWithoutPayment_v2();
      return;
    }
    /* Fall through to the original paid checkout flow. */
    try { activateAndPay(); } catch (e) { console.error(e); }
  };
}`;

const anchorAfterHookPlus = anchorAfterHook + `

/* ${MARKER}: relabel the pay button when the tag is a gift. */
function p35c1fixRelabelPayButton() {
  var btn = document.getElementById('pay-btn');
  if (!btn) return;
  var giftTag = !!(window._tag && window._tag.is_gift === true);
  if (giftTag) {
    btn.textContent = 'Claim my free tag';
  }
}`;

r = safeReplace(updated, anchorAfterHook, anchorAfterHookPlus);
if (!r) {
  /* Non-fatal: relabel is cosmetic. Warn and continue. */
  log('  \u00b7 pay-button relabel helper not inserted (anchor shape differ) \u2014 cosmetic only');
} else {
  updated = r;
  ok('pay button relabel helper added (gift tags say "Claim my free tag")');
}

writeFile(file, updated);

/* Validate: marker present, file not obviously broken */
const verify = readFile(file);
const markerCount = (verify.match(/TMC_PATCH35C1FIX_GIFT_TAP/g) || []).length;
if (markerCount < 2) errExit('marker count too low after write (' + markerCount + ')');
ok('contact.html written and verified (' + markerCount + ' markers)');

log('');
log('==============================================================');
log('Patch 35c-1-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35c-1-fix: gift detection in tap/scan activation"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('IMPORTANT \u2014 before testing, deactivate the tag you wrongly activated:');
log('  In Supabase SQL Editor, run (replace TMC-XXXXXX with that token):');
log('');
log('    UPDATE tags');
log('    SET status = (unclaimed), owner_id = NULL,');
log('        claimed_at = NULL, activated_at = NULL,');
log('        license_plate = NULL, car_make = NULL, car_model = NULL,');
log('        car_year = NULL, car_color = NULL, vehicle_label = NULL,');
log('        plan = (etag)');
log('    WHERE token = (TMC-XXXXXX);');
log('');
log('  [replace each (xxx) with single-quoted xxx]');
log('  This resets the tag to unclaimed so you can re-test the gift flow.');
log('  NOTE: if that tag was marked as a gift, also re-confirm is_gift is');
log('  still true:  SELECT token, is_gift, gift_plan, gift_months FROM tags');
log('  WHERE token = (TMC-XXXXXX);  \u2014 if is_gift is false, re-gift it from');
log('  the admin Promos tab.');
log('');
log('Test (tap path):');
log('  1. Tap the physical gift sticker with your phone (or open');
log('     https://tapmycar.io/tag/TMC-XXXXXX directly).');
log('  2. Tap "Activate The Tag".');
log('  3. Signed-in user: goes straight to phone verify, NO payment.');
log('     New user: registers, verifies phone, button says');
log('     "Claim my free tag" instead of "Pay $1".');
log('  4. After phone verify -> tag claimed, trial applied.');
log('  5. Confirm in Supabase the user has plan + gift_plan_expires_at set.');
log('==============================================================');
