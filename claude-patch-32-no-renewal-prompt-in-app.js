#!/usr/bin/env node
/* ============================================================================
 * claude-patch-32-no-renewal-prompt-in-app.js
 * ----------------------------------------------------------------------------
 * APP STORE GUIDELINE 3.1.1 RISK - the renewal prompt is purchase UI inside the
 * native app.
 *
 * public/app-renewal-prompt.js (shipped in patch 46, long before this session)
 * injects a banner and a modal reading "Renew to keep your tag active", and its
 * button calls startRenew(), which navigates to /renew.html - a payment flow.
 * It has NO platform guard, so it renders inside the iOS and Android apps just
 * as it does on the website.
 *
 * You were already rejected once under Guideline 3.1.1 for in-app payment UI,
 * and your compliance model is Path A: billing happens ONLY in external Safari.
 * An in-app "Renew now" button contradicts that and is a rejection risk on
 * every future submission.
 *
 * THE FIX: the prompt does not render inside the app at all. On the website it
 * is completely unchanged.
 *
 * WHY THIS IS THE RIGHT GUARD: window.tmcIsInApp is set by tmc-platform.js and
 * is the same signal app.js already uses to disable idle logout in the app, so
 * this follows an established pattern rather than inventing detection. The
 * check is defensive - it also reads window.Capacitor directly, because
 * tmc-platform.js loads asynchronously and may not have run yet when the
 * renewal prompt initialises. Either signal is enough to suppress.
 *
 * WHAT THE USER SEES INSTEAD: nothing in-app. Renewal is handled the same way
 * as every other billing action - through the website in external Safari. This
 * loses no revenue path; it moves it to the compliant one.
 *
 * NOT A REPLACEMENT FOR THE DATA FIX: the build currently in review already
 * contains the unguarded file. Resetting the reviewer account's created_at
 * suppresses the banner in that binary today. This patch protects every build
 * from the next one onward.
 *
 * SECURITY: removes purchase UI from a surface where it should not exist. No
 * new endpoint, no new input, no change to entitlements, no change to any
 * server-side check. Purely a client-side early return.
 *
 * SCOPE: public/app-renewal-prompt.js only. Live on the website on push (where
 * behaviour is unchanged), and reaches the apps at your next `npx cap sync` -
 * which you must run before the next iOS build for this to take effect.
 *
 * SAFE / IDEMPOTENT: timestamped backup, latin1 byte preservation, ASCII-only
 * insertion, anchor must match exactly once, file re-parsed after edit,
 * behavioural test of the guard, auto-restore on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = path.join('public', 'app-renewal-prompt.js');
const MARKER = 'TMC_PATCH32_NO_INAPP_RENEWAL';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
let backup = null;
function die(msg, restore) {
  if (restore && backup) { try { fs.copyFileSync(backup, TARGET); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  ' + TARGET + ' restored from ' + backup + '\n'
                        : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

if (!fs.existsSync(TARGET)) die('Cannot find ' + TARGET + '. Run from the tapmycar project root.');

const src = fs.readFileSync(TARGET, 'latin1');

if (src.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' found).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Anchor: the guard at the top of shouldShow ─────────────────────────────
const A = [
  "  function shouldShow(user) {",
  "    if (!user) return false;"
].join('\n');

const n = countOf(src, A);
if (n !== 1) die('shouldShow anchor matched ' + n + ' times (expected exactly 1).');

const R = [
  "  /* " + MARKER + ": the renewal banner and modal are PURCHASE UI - the",
  "     button navigates to /renew.html. App Store Guideline 3.1.1 forbids that",
  "     inside the app, and this app was already rejected once for in-app",
  "     payment UI. Billing is Path A: external Safari only. So the prompt never",
  "     renders in the app. Website behaviour is completely unchanged.",
  "",
  "     Both signals are checked because tmc-platform.js sets window.tmcIsInApp",
  "     asynchronously and may not have run yet when this initialises; reading",
  "     window.Capacitor directly covers that race. */",
  "  function tmcIsNativeApp() {",
  "    try {",
  "      if (typeof window === 'undefined') return false;",
  "      if (window.tmcIsInApp === true) return true;",
  "      if (window.Capacitor && typeof window.Capacitor === 'object') {",
  "        if (window.Capacitor.isNativePlatform === true) return true;",
  "        if (typeof window.Capacitor.isNativePlatform === 'function' &&",
  "            window.Capacitor.isNativePlatform()) return true;",
  "        if (window.Capacitor.platform && window.Capacitor.platform !== 'web') return true;",
  "      }",
  "    } catch (e) {}",
  "    return false;",
  "  }",
  "",
  "  function shouldShow(user) {",
  "    if (!user) return false;",
  "    if (tmcIsNativeApp()) return false; /* " + MARKER + " */"
].join('\n');

if (/[^\x00-\x7F]/.test(R)) die('internal error: non-ASCII in insertion.');

// ── Apply ───────────────────────────────────────────────────────────────────
backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);
fs.writeFileSync(TARGET, src.replace(A, function () { return R; }), 'latin1');

// ── Verify ──────────────────────────────────────────────────────────────────
try {
  const chk = fs.readFileSync(TARGET, 'latin1');

  if (chk.indexOf(MARKER) === -1) die('marker missing after write.', true);
  if (chk.indexOf('tmcIsNativeApp') === -1) die('guard function missing.', true);

  // File must still parse.
  try { new (require('vm').Script)(require('module').wrap(chk), { filename: TARGET }); }
  catch (e) { die(TARGET + ' no longer parses: ' + e.message, true); }

  // Original web behaviour must be intact.
  for (const need of ["if (user.subscription_id) return false;", 'GRACE_DAYS', 'startRenew']) {
    if (chk.indexOf(need) === -1) die('lost original logic: ' + need, true);
  }

  // Behavioural test against the REAL extracted functions.
  {
    const gs = chk.indexOf('function tmcIsNativeApp()');
    const ge = chk.indexOf('\n  }', gs);
    const guardFn = chk.slice(gs, ge + 4);
    const ss = chk.indexOf('function shouldShow(user)');
    const se = chk.indexOf('\n  }', ss);
    const showFn = chk.slice(ss, se + 4);
    const gm = chk.match(/var GRACE_DAYS\s*=\s*(\d+)/);
    if (!gm) die('could not read GRACE_DAYS.', true);

    const build = (win) => new Function(
      'window', 'GRACE_DAYS',
      guardFn + '\n' + showFn + '\nreturn shouldShow;'
    )(win, Number(gm[1]));

    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    const lapsed = { plan: 'standard', created_at: old };

    const cases = [
      ['WEB   lapsed user -> banner shows',        {}, lapsed, true],
      ['APP   tmcIsInApp -> suppressed',           { tmcIsInApp: true }, lapsed, false],
      ['APP   Capacitor bool -> suppressed',       { Capacitor: { isNativePlatform: true } }, lapsed, false],
      ['APP   Capacitor fn -> suppressed',         { Capacitor: { isNativePlatform: () => true } }, lapsed, false],
      ['APP   Capacitor platform ios -> suppressed', { Capacitor: { platform: 'ios' } }, lapsed, false],
      ['WEB   Capacitor platform web -> shows',    { Capacitor: { platform: 'web' } }, lapsed, true],
      ['WEB   active subscriber -> no banner',     {}, { plan: 'standard', created_at: old, subscription_id: 's1' }, false],
      ['WEB   free user -> no banner',             {}, { plan: 'etag', created_at: old }, false],
      ['WEB   new account -> no banner',           {}, { plan: 'standard', created_at: new Date().toISOString() }, false]
    ];
    for (const [label, win, user, want] of cases) {
      let got;
      try { got = build(win)(user); }
      catch (e) { die('case "' + label + '" threw: ' + e.message, true); }
      if (got !== want) die('case "' + label + '" returned ' + got + ', expected ' + want, true);
    }
  }

  const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
  const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die('special characters changed (' + nb + ' -> ' + na + ').', true);

  console.log('\n  OK  ' + TARGET + ' patched.');
  console.log('      backup: ' + backup);
  console.log('');
  console.log('      The renewal banner and modal NO LONGER render inside the');
  console.log('      iOS or Android app. Website behaviour is unchanged.');
  console.log('      Removes an in-app purchase path (Guideline 3.1.1).');
  console.log('');
  console.log('      YOU MUST RUN  npx cap sync  BEFORE THE NEXT iOS BUILD');
  console.log('      or the app will still contain the unguarded file.');
  console.log('');
  console.log('      This does NOT change the binary already in review - fix');
  console.log('      that by resetting the reviewer account created_at.\n');
} catch (verifyErr) {
  if (verifyErr && verifyErr.__tmcDie) throw verifyErr;
  die('unexpected error during verification: ' + (verifyErr && verifyErr.message), true);
}
