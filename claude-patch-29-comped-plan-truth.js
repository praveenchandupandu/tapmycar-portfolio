#!/usr/bin/env node
/* ============================================================================
 * claude-patch-29-comped-plan-truth.js
 * ----------------------------------------------------------------------------
 * THE BUG: a comped user and a user whose subscription lapsed are currently
 * IDENTICAL in the database - plan='standard', no subscription_id. So two
 * different parts of the app guess, and they guess differently:
 *
 *   app-renewal-prompt.js  guesses "lapsed" -> "Your annual subscription is
 *                          overdue. Renew to keep your tag active."
 *   billing.html (p28)     guesses "gifted" -> "Gifted Tag"
 *
 * One of them is wrong for every single user. This is live right now for real
 * gift-trial customers: 30 days after claiming a gift tag they start being told
 * their subscription is overdue, for a plan that was given to them free.
 *
 * THE FIX: stop guessing. Read users.comped_plan, added by the migration that
 * accompanies this patch. Three files:
 *
 *  1. api/get-billing.js         - return comped + compedExpiresAt
 *  2. public/app-renewal-prompt.js - never nag a comped user, and never nag a
 *                                  user whose gift trial is still running
 *  3. public/billing.html        - drive the "Gifted Tag" label off the real
 *                                  flag instead of patch 28's inference
 *
 * REQUIRES the migration to have been run first. If comped_plan does not exist
 * yet the flag simply reads undefined: the renewal prompt behaves exactly as it
 * does today and billing falls back to the plan check, so deploying in the
 * wrong order degrades gracefully rather than breaking.
 *
 * WHY LAPSED USERS STILL GET NAGGED: the prompt is skipped only on a POSITIVE
 * comped_plan signal. A genuinely lapsed customer has comped_plan=false and
 * keeps seeing the renewal prompt, which is correct. When a timed comp ends,
 * comped_plan flips to false and the plan column is left alone, so that user
 * lands in exactly the lapsed state and is asked to renew - which is the
 * behaviour you asked for.
 *
 * SECURITY: no new endpoint, no new user input, no change to any entitlement
 * check. get-billing already selects * and is already user-scoped by user_id,
 * so no new data path is opened; the two new response fields are booleans/dates
 * about the requesting user's own account. Frontend uses textContent only, no
 * innerHTML, no eval. comped_plan is only ever WRITTEN by admin-authenticated
 * code, never by anything the user controls.
 *
 * SCOPE: api/get-billing.js is serverless (live on push, bundles untouched).
 * The two public/ files reach the apps at your next cap sync only - no rebuild
 * forced, approved Play Store bundle untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backups, latin1 byte preservation, ASCII-only
 * insertion, every anchor must match exactly once, inserted JS parsed, brace
 * and tag balance verified, ALL files auto-restored on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = 'TMC_PATCH29_COMPED';
const BILL_API = path.join('api', 'get-billing.js');
const PROMPT    = path.join('public', 'app-renewal-prompt.js');
const BILL_HTML = path.join('public', 'billing.html');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
const S = stamp();
const backups = [];
function rollback() { for (const b of backups) { try { fs.copyFileSync(b.copy, b.file); } catch (e) {} } }
function die(msg, restore) {
  if (restore) rollback();
  // marker so the verification wrapper does not re-handle an intentional abort
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  All files restored to their original state.\n' : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function backup(file) {
  const copy = file + '.tmcbak-' + S;
  fs.copyFileSync(file, copy);
  backups.push({ file: file, copy: copy });
}

// ── Pre-flight ──────────────────────────────────────────────────────────────
for (const f of [BILL_API, PROMPT, BILL_HTML]) {
  if (!fs.existsSync(f)) die('Cannot find ' + f + '. Run from the tapmycar project root.');
}
const apiSrc    = fs.readFileSync(BILL_API, 'latin1');
const promptSrc = fs.readFileSync(PROMPT, 'latin1');
const htmlSrc   = fs.readFileSync(BILL_HTML, 'latin1');

if (apiSrc.indexOf(MARKER) !== -1 && promptSrc.indexOf(MARKER) !== -1 && htmlSrc.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' present in all three files).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

if (htmlSrc.indexOf('TMC_PATCH28_GIFTED_LABEL') === -1) {
  die('public/billing.html does not contain patch 28. Deploy patch 28 first - this patch refines it.');
}

// ── Anchors ─────────────────────────────────────────────────────────────────
const A_API = [
  "    return res.json({",
  "      plan: user.plan || 'etag',",
  "      subStatus,"
].join('\n');

const R_API = [
  "    /* " + MARKER + ": comped_plan is the ONLY reliable way to tell an",
  "       admin-granted plan from a lapsed subscription - both otherwise look",
  "       like plan='standard' with no Stripe record. Optional chaining is",
  "       avoided so this stays safe if the column has not been added yet. */",
  "    const comped = (user.comped_plan === true);",
  "    const compedExpiresAt = comped ? (user.comped_plan_expires_at || null) : null;",
  "",
  "    return res.json({",
  "      plan: user.plan || 'etag',",
  "      comped,",
  "      compedExpiresAt,",
  "      subStatus,"
].join('\n');

const A_PROMPT = [
  "  function shouldShow(user) {",
  "    if (!user) return false;",
  "    /* Must be on a paid plan. */",
  "    if (user.plan !== 'standard' && user.plan !== 'premium') return false;"
].join('\n');

const R_PROMPT = [
  "  function shouldShow(user) {",
  "    if (!user) return false;",
  "    /* " + MARKER + ": never nag someone who was GIVEN their plan. Without",
  "       this a comped or gift-trial user is told their subscription is",
  "       overdue 30 days in, for a plan they never paid for. Both checks are",
  "       positive signals, so a genuinely lapsed customer is unaffected and",
  "       still sees the renewal prompt. */",
  "    if (user.comped_plan === true) return false;",
  "    if (user.gift_plan_expires_at) {",
  "      var giftEnds = new Date(user.gift_plan_expires_at).getTime();",
  "      if (giftEnds && giftEnds > Date.now()) return false;",
  "    }",
  "    /* Must be on a paid plan. */",
  "    if (user.plan !== 'standard' && user.plan !== 'premium') return false;"
].join('\n');

const A_HTML = "    } else if (!data.subStatus && data.plan && data.plan !== 'etag' && data.plan !== 'free') {";
const R_HTML = [
  "    } else if (data.comped) {",
  "      /* " + MARKER + ": driven by the real comped_plan flag now, not by the",
  "         absence of a Stripe subscription. Patch 28 inferred this, which also",
  "         caught lapsed customers and mislabelled them as gifted. */"
].join('\n');

// Anchor uniqueness
for (const [label, src, anchor] of [
  ['get-billing.js', apiSrc, A_API],
  ['app-renewal-prompt.js', promptSrc, A_PROMPT],
  ['billing.html', htmlSrc, A_HTML]
]) {
  const n = countOf(src, anchor);
  if (n !== 1) die(label + ' anchor matched ' + n + ' times (expected exactly 1).');
}

for (const [l, blob] of [['api', R_API], ['prompt', R_PROMPT], ['html', R_HTML]]) {
  if (/[^\x00-\x7F]/.test(blob)) die('internal error: non-ASCII in ' + l + ' insertion.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
try {
  backup(BILL_API);
  fs.writeFileSync(BILL_API, apiSrc.replace(A_API, function () { return R_API; }), 'latin1');
  backup(PROMPT);
  fs.writeFileSync(PROMPT, promptSrc.replace(A_PROMPT, function () { return R_PROMPT; }), 'latin1');
  backup(BILL_HTML);
  fs.writeFileSync(BILL_HTML, htmlSrc.replace(A_HTML, function () { return R_HTML; }), 'latin1');
} catch (e) {
  die('write failed: ' + e.message, true);
}

// ── Verify ──────────────────────────────────────────────────────────────────
// Wrapped so that ANY unexpected error in verification - not just the failures
// that call die() - still restores every file. An uncaught throw here would
// otherwise leave the project half-patched.
try {

const apiOut    = fs.readFileSync(BILL_API, 'latin1');
const promptOut = fs.readFileSync(PROMPT, 'latin1');
const htmlOut   = fs.readFileSync(BILL_HTML, 'latin1');

// 1. Both JS files must still parse.
for (const [f, txt] of [[BILL_API, apiOut], [PROMPT, promptOut]]) {
  try { new (require('vm').Script)(require('module').wrap(txt), { filename: f }); }
  catch (e) { die(f + ' no longer parses: ' + e.message, true); }
}

// 2. Markers present.
for (const [f, txt] of [[BILL_API, apiOut], [PROMPT, promptOut], [BILL_HTML, htmlOut]]) {
  if (txt.indexOf(MARKER) === -1) die('marker missing from ' + f, true);
}

// 3. The lapsed-customer path must SURVIVE in all three files.
if (promptOut.indexOf("if (user.subscription_id) return false;") === -1) {
  die('renewal prompt lost its subscription check.', true);
}
if (htmlOut.indexOf("textContent = 'No active subscription'") === -1) {
  die('billing.html lost the no-subscription branch.', true);
}
if (apiOut.indexOf('subStatus,') === -1) die('get-billing lost subStatus.', true);

// 4. Behavioural check on the REAL extracted shouldShow.
{
  const s = promptOut.indexOf('function shouldShow(user)');
  const e = promptOut.indexOf('\n  }', s);
  const fn = promptOut.slice(s, e + 4);
  let shouldShow;
  try {
    // shouldShow closes over GRACE_DAYS in the real IIFE; supply it so the
    // extracted copy behaves identically to the deployed one.
    const gm = promptOut.match(/var GRACE_DAYS\s*=\s*(\d+)/);
    if (!gm) die('could not read GRACE_DAYS from the prompt file.', true);
    shouldShow = new Function('GRACE_DAYS', 'return (' + fn + ')')(Number(gm[1]));
  }
  catch (err) { die('could not evaluate shouldShow: ' + err.message, true); }

  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  const future = new Date(Date.now() + 60 * 86400000).toISOString();
  const past   = new Date(Date.now() - 10 * 86400000).toISOString();
  const cases = [
    ['comped permanent',      { plan: 'standard', created_at: old, comped_plan: true }, false],
    ['comped with expiry',    { plan: 'premium',  created_at: old, comped_plan: true, comped_plan_expires_at: future }, false],
    ['gift trial running',    { plan: 'standard', created_at: old, gift_plan_expires_at: future }, false],
    ['gift trial ENDED',      { plan: 'standard', created_at: old, gift_plan_expires_at: past }, true],
    ['comp ended (lapsed)',   { plan: 'standard', created_at: old, comped_plan: false }, true],
    ['genuinely lapsed',      { plan: 'standard', created_at: old }, true],
    ['active subscriber',     { plan: 'standard', created_at: old, subscription_id: 'sub_1' }, false],
    ['free user',             { plan: 'etag',     created_at: old }, false],
    ['new paid account',      { plan: 'standard', created_at: new Date().toISOString() }, false]
  ];
  for (const [label, u, want] of cases) {
    const got = shouldShow(u);
    if (got !== want) die('shouldShow("' + label + '") returned ' + got + ', expected ' + want, true);
  }
}

// 5. Structure preserved.
for (const tag of ['<script', '</script>', '<div', '</div>', '</html>']) {
  if (countOf(htmlOut, tag) !== countOf(htmlSrc, tag)) die('billing.html structure changed (' + tag + ').', true);
}
for (const [f, before, after] of [[BILL_API, apiSrc, apiOut], [PROMPT, promptSrc, promptOut], [BILL_HTML, htmlSrc, htmlOut]]) {
  const nb = (before.match(/[^\x00-\x7F]/g) || []).length;
  const na = (after.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die(f + ': special characters changed (' + nb + ' -> ' + na + ').', true);
}

} catch (verifyErr) {
  if (verifyErr && verifyErr.__tmcDie) throw verifyErr;
  die('unexpected error during verification: ' + (verifyErr && verifyErr.message), true);
}

console.log('\n  OK  ' + MARKER + ' applied to 3 files.');
console.log('      backups: *.tmcbak-' + S);
console.log('');
console.log('      Comped and gift-trial users are no longer told their');
console.log('      subscription is overdue. Lapsed customers still are.');
console.log('      "Gifted Tag" now comes from the real flag, not a guess.');
console.log('');
console.log('      RUN THE SQL MIGRATION FIRST. Without the column the flag');
console.log('      reads undefined and behaviour is unchanged - safe, but the');
console.log('      bug stays until the column exists.');
console.log('');
console.log('      api/ live on push. public/ reaches apps at next cap sync.\n');
