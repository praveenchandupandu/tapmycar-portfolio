#!/usr/bin/env node
/* ============================================================================
 * claude-patch-36-otp-paste-and-photo-close.js
 * ----------------------------------------------------------------------------
 * Fixes two reported iPhone bugs. Both are front-end only.
 *
 * BUG 1 - the stranger-photo viewer won't close.
 *   In public/activity.html the photo lightbox's close (X) button is pinned to
 *   top:18px. On a notched iPhone that sits UNDER the status bar / notch, so
 *   iOS swallows the taps before they reach the button. The page already has a
 *   safe-area fix for the top nav bar but it was never applied to this button.
 *   FIX: top:18px -> top:calc(18px + env(safe-area-inset-top)) so the X drops
 *   below the status bar and becomes tappable. One-property CSS change.
 *
 * BUG 2 - pasting a 6-digit code only fills one box.
 *   initOTP() in public/app.js grabbed EVERY .otp-box on the page as one flat
 *   strip. contact.html stacks THREE separate 6-box code fields (phone, email,
 *   step-3), so "all boxes" was 18, and a paste could never target the right
 *   six. Worse, each box has maxlength="1": on iOS the clipboard `paste` event
 *   is unreliable, and the dependable fallback - the `input` event spreading a
 *   multi-digit value - never fired because maxlength="1" truncated the pasted
 *   string to a single character before that code could see it.
 *   FIX: wire each .otp-row group independently (so a paste fills the correct
 *   six), and strip maxlength at runtime so a pasted/autofilled multi-digit
 *   value reaches the input-spread path. Single-digit-per-box is still enforced
 *   in JS, so nothing about normal typing changes.
 *
 *   Backward compatible: signin.html and register.html each have exactly one
 *   .otp-row of six boxes, so they behave identically (and keep auto-submit,
 *   since 6 === group length). Pages with .otp-box but no .otp-row fall back to
 *   treating all boxes as one group. Pages with no .otp-box are untouched.
 *
 * SCOPE: public/app.js and public/activity.html. These ship in the app bundle,
 * so run `npx cap sync` before the next Android/iOS build. On the website they
 * go live on push. No payment UI, no wording, no API change - safe during
 * review.
 *
 * SAFE / IDEMPOTENT: timestamped backups, anchors must match exactly once,
 * app.js is re-parsed after editing, special-character counts are asserted
 * unchanged, and ANY failure restores every file touched.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join('public', 'app.js');
const ACT = path.join('public', 'activity.html');
const MARK_APP = 'TMC_PATCH36_OTP_PASTE';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
const backups = [];
function die(msg) {
  for (const b of backups) { try { fs.copyFileSync(b.bak, b.file); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(backups.length ? '  Restored ' + backups.length + ' file(s).\n'
                               : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

if (!fs.existsSync(APP)) die('Cannot find ' + APP + '. Run from the tapmycar project root.');
if (!fs.existsSync(ACT)) die('Cannot find ' + ACT + '.');

/* ===========================================================================
 * PART 1 - public/app.js : replace the whole initOTP() function
 * ======================================================================== */
const appSrc = fs.readFileSync(APP, 'latin1');

let appAlready = appSrc.indexOf(MARK_APP) !== -1;

/* Boundary anchors. We replace everything from the start of initOTP up to the
   start of the next function, so internal whitespace / line endings inside the
   old function do not have to be matched byte-for-byte. */
const A_START = 'function initOTP() {';
const A_NEXT = 'function getOTPValue()';

if (!appAlready) {
  if (countOf(appSrc, A_START) !== 1) die('initOTP start anchor not found exactly once in app.js.');
  if (countOf(appSrc, A_NEXT) !== 1) die('getOTPValue anchor not found exactly once in app.js.');

  const iStart = appSrc.indexOf(A_START);
  const iEnd = appSrc.indexOf(A_NEXT);
  if (iStart === -1 || iEnd === -1 || iStart >= iEnd) {
    die('initOTP region boundaries are invalid in app.js.');
  }

  const EOL = appSrc.indexOf('\r\n') !== -1 ? '\r\n' : '\n';

  const NEW_LINES = [
    'function initOTP() {',
    '  /* ' + MARK_APP + ': wire each .otp-row group on its own. contact.html',
    '     stacks THREE 6-box code fields on one page; the old code grabbed all 18',
    '     boxes as a single strip, so a paste could land in the wrong field. Also',
    '     strips maxlength at runtime: on iOS the clipboard paste event is',
    '     unreliable, but the input-event spread path IS reliable - and',
    '     maxlength="1" was silently truncating the pasted value before that path',
    '     could see it. Single-digit-per-box is still enforced in JS below. */',
    '  var rows = document.querySelectorAll(\'.otp-row\');',
    '  var groups = rows.length',
    '    ? Array.prototype.map.call(rows, function (r) { return r.querySelectorAll(\'.otp-box\'); })',
    '    : [document.querySelectorAll(\'.otp-box\')];',
    '',
    '  groups.forEach(function (boxes) {',
    '    if (!boxes.length) return;',
    '',
    '    function submitOTP() {',
    '      if (typeof window.signIn === \'function\') window.signIn();',
    '      else if (typeof window.verifyOTP === \'function\') window.verifyOTP();',
    '    }',
    '',
    '    function fillBoxes(digits) {',
    '      var clean = String(digits || \'\').replace(/\\D/g, \'\').slice(0, boxes.length);',
    '      if (!clean) return;',
    '      for (var i = 0; i < boxes.length; i++) {',
    '        boxes[i].value = clean[i] || \'\';',
    '        if (clean[i]) boxes[i].classList.add(\'filled\');',
    '        else boxes[i].classList.remove(\'filled\');',
    '      }',
    '      var lastFilled = Math.min(clean.length, boxes.length) - 1;',
    '      if (lastFilled >= 0) boxes[lastFilled].focus();',
    '      if (clean.length === boxes.length) setTimeout(submitOTP, 200);',
    '    }',
    '',
    '    Array.prototype.forEach.call(boxes, function (box, i) {',
    '      box.removeAttribute(\'maxlength\');',
    '',
    '      box.addEventListener(\'input\', function (e) {',
    '        var val = e.target.value;',
    '        if (val.length > 1) { fillBoxes(val); return; }',
    '        if (val.length >= 1) {',
    '          box.value = val[val.length - 1];',
    '          box.classList.add(\'filled\');',
    '          if (i < boxes.length - 1) boxes[i + 1].focus();',
    '        } else {',
    '          box.classList.remove(\'filled\');',
    '        }',
    '      });',
    '',
    '      box.addEventListener(\'keydown\', function (e) {',
    '        if (e.key === \'Backspace\' && !box.value && i > 0) {',
    '          boxes[i - 1].focus();',
    '          boxes[i - 1].classList.remove(\'filled\');',
    '        }',
    '        if (e.key === \'Enter\') {',
    '          e.preventDefault();',
    '          var full = Array.prototype.map.call(boxes, function (b) { return b.value; }).join(\'\');',
    '          if (full.length === boxes.length) submitOTP();',
    '        }',
    '      });',
    '',
    '      box.addEventListener(\'paste\', function (e) {',
    '        var pasted = (e.clipboardData || window.clipboardData).getData(\'text\');',
    '        if (pasted && /\\d/.test(pasted)) {',
    '          e.preventDefault();',
    '          fillBoxes(pasted);',
    '        }',
    '      });',
    '    });',
    '  });',
    '}',
    ''
  ];
  const NEW_FN = NEW_LINES.join(EOL);

  if (/[^\x00-\x7F]/.test(NEW_FN)) die('internal error: non-ASCII in the new initOTP.');

  const bak = APP + '.tmcbak-' + stamp();
  fs.copyFileSync(APP, bak);
  backups.push({ file: APP, bak: bak });

  const appOut = appSrc.slice(0, iStart) + NEW_FN + appSrc.slice(iEnd);
  fs.writeFileSync(APP, appOut, 'latin1');
} else {
  console.log('  . app.js already patched (' + MARK_APP + ') - skipping.');
}

/* ===========================================================================
 * PART 2 - public/activity.html : safe-area on the lightbox close button
 * ======================================================================== */
const actSrc = fs.readFileSync(ACT, 'latin1');

const OLD_LB = '.p13-lightbox-close{position:absolute;top:18px;';
const NEW_LB = '.p13-lightbox-close{position:absolute;top:calc(18px + env(safe-area-inset-top));';
const ALT_LB = '.p13-lightbox-close{position:absolute;top:calc(';

let actAlready = actSrc.indexOf(ALT_LB) !== -1;

if (!actAlready) {
  if (countOf(actSrc, OLD_LB) !== 1) die('lightbox close anchor not found exactly once in activity.html.');

  const bak = ACT + '.tmcbak-' + stamp();
  fs.copyFileSync(ACT, bak);
  backups.push({ file: ACT, bak: bak });

  const actOut = actSrc.replace(OLD_LB, function () { return NEW_LB; });
  fs.writeFileSync(ACT, actOut, 'latin1');
} else {
  console.log('  . activity.html already patched (safe-area close) - skipping.');
}

/* ===========================================================================
 * VERIFY
 * ======================================================================== */
try {
  /* --- app.js --- */
  const appChk = fs.readFileSync(APP, 'latin1');

  if (appChk.indexOf(MARK_APP) === -1) die('verification failed: ' + MARK_APP + ' missing from app.js.', true);
  if (countOf(appChk, 'function initOTP() {') !== 1) die('initOTP defined ' + countOf(appChk, 'function initOTP() {') + ' times (expected 1).');
  if (countOf(appChk, 'function getOTPValue()') !== 1) die('getOTPValue count changed in app.js.');
  for (const need of ['.otp-row', 'removeAttribute(\'maxlength\')', 'querySelectorAll(\'.otp-box\')', 'addEventListener(\'paste\'', 'fillBoxes']) {
    if (appChk.indexOf(need) === -1) die('app.js missing expected piece: ' + need);
  }
  /* Must still parse as JS. */
  try { new (require('vm').Script)(require('module').wrap(appChk), { filename: APP }); }
  catch (e) { die('app.js no longer parses: ' + e.message); }

  const nbA = (appSrc.match(/[^\x00-\x7F]/g) || []).length;
  const naA = (appChk.match(/[^\x00-\x7F]/g) || []).length;
  if (nbA !== naA) die('special characters changed in app.js (' + nbA + ' -> ' + naA + ').');

  /* --- activity.html --- */
  const actChk = fs.readFileSync(ACT, 'latin1');
  if (actChk.indexOf('env(safe-area-inset-top)') === -1) die('activity.html: safe-area not present after patch.');
  if (countOf(actChk, '.p13-lightbox-close{position:absolute;') !== 1) die('activity.html: close-button rule count changed.');
  if (actChk.indexOf('top:18px;right:18px') !== -1 && actChk.indexOf('.p13-lightbox-close{position:absolute;top:18px;') !== -1) {
    die('activity.html: old top:18px still on the close button.');
  }
  /* meta caption line must be untouched */
  if (actChk.indexOf('.p13-lightbox-meta') === -1) die('activity.html: lightbox meta rule went missing.');

  const nbC = (actSrc.match(/[^\x00-\x7F]/g) || []).length;
  const naC = (actChk.match(/[^\x00-\x7F]/g) || []).length;
  if (nbC !== naC) die('special characters changed in activity.html (' + nbC + ' -> ' + naC + ').');

  console.log('\n  OK  Patch 36 applied.\n');
  if (backups.length) {
    console.log('      Backups:');
    backups.forEach(b => console.log('        ' + b.bak));
  }
  console.log('');
  console.log('      app.js       - OTP boxes now wired per .otp-row group;');
  console.log('                     maxlength stripped so paste fills all six.');
  console.log('      activity.html- photo close (X) dropped below the status bar');
  console.log('                     via env(safe-area-inset-top).');
  console.log('');
  console.log('      Front-end: run `npx cap sync` before the next app build.');
  console.log('      Website goes live on push. No payment/wording/API change.\n');
} catch (verifyErr) {
  if (verifyErr && verifyErr.__tmcDie) throw verifyErr;
  die('unexpected error during verification: ' + (verifyErr && verifyErr.message));
}
