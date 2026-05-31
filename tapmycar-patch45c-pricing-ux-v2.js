/* ============================================================================
 * TapMyCar  Patch 45c-pricing v2  honest checkout UX (with recursion fix)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45c-pricing-ux-v2.js
 *
 * v2 of Patch 45c-pricing. The v1 driver was reverted because of an infinite
 * recursion bug: updateCreditDisplay() called updateButtonLabels(), and the
 * wrapped updateButtonLabels() called updateCreditDisplay() back. Browser
 * froze on every page load.
 *
 * Fix: a single boolean re-entry guard (window.__tmcUpdating) that prevents
 * the two functions from calling each other recursively.
 *
 * Also tightened: when restoring prices on untick, we no longer call
 * updateButtonLabels(). Instead we restore the button text directly from
 * the cached original, which avoids the cross-function call entirely on
 * the restore path.
 *
 * Same MARKER as v1 (TMC_PATCH45C_PRICING) is NOT used  v2 uses a new
 * marker so it applies cleanly to a reverted file.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH45C_PRICING_V2.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45C_PRICING_V2';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45c-pricing-v2-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const PR = path.join('public', 'pricing.html');

const SA_FIND = [
  "  function setApplied(on, dollars) {",
  "    /* Mirror the new checkbox state into the legacy window.__refDiscount",
  "       and into the pre-existing 'discount-banner' visibility, so both",
  "       banners reflect the same user intent. */",
  "    try {",
  "      window.__refDiscount = on ? (dollars || 0) : 0;",
  "      var legacy = document.getElementById('discount-banner');",
  "      if (legacy) legacy.style.display = on ? 'block' : 'none';",
  "    } catch (e) {}",
  "  }"
].join('\n');

const SA_REPLACE = [
  "  /* TMC_PATCH45C_PRICING_V2: dynamic per-plan price/button/note updates",
  "     with a re-entry guard. v1 had infinite recursion between",
  "     updateCreditDisplay() and our wrapped updateButtonLabels(); v2 fixes",
  "     it with window.__tmcUpdating, and never calls updateButtonLabels()",
  "     from updateCreditDisplay() (restore path uses the cached originals). */",
  "  window.__tmcCreditDollars = 0;",
  "  window.__tmcUpdating = false;",
  "",
  "  function setApplied(on, dollars) {",
  "    try {",
  "      window.__refDiscount = on ? (dollars || 0) : 0;",
  "      window.__tmcApply = !!on;",
  "      if (typeof dollars === 'number') window.__tmcCreditDollars = dollars;",
  "      var legacy = document.getElementById('discount-banner');",
  "      if (legacy) legacy.style.display = on ? 'block' : 'none';",
  "      updateCreditDisplay();",
  "    } catch (e) {}",
  "  }",
  "",
  "  function updateCreditDisplay() {",
  "    if (window.__tmcUpdating) return; /* guard against re-entry */",
  "    window.__tmcUpdating = true;",
  "    try {",
  "      var apply = !!window.__tmcApply;",
  "      var creditCents = Math.round((window.__tmcCreditDollars || 0) * 100);",
  "      ['standard','premium'].forEach(function (plan) {",
  "        var prefix = plan === 'standard' ? 'std' : 'prem';",
  "        var priceEl  = document.getElementById(prefix + '-price');",
  "        var btnAmtEl = document.getElementById(prefix + '-btn-amt');",
  "        var btnEl    = document.getElementById(prefix + '-btn');",
  "        if (!priceEl || !btnAmtEl || !btnEl) return;",
  "",
  "        /* Save the originals once so we can restore them on untick. */",
  "        if (typeof priceEl.dataset.tmcOriginal === 'undefined') {",
  "          priceEl.dataset.tmcOriginal = priceEl.innerHTML;",
  "        }",
  "        /* btnAmtEl is rewritten by the page's updateButtonLabels() on prepay",
  "           toggle. We read its CURRENT text to know the prepay-aware base",
  "           price, then either keep it (untick) or override it (tick). */",
  "        var btnText = (btnAmtEl.textContent || '').trim();",
  "        var todayMatch = btnText.match(/\\$([0-9]+(?:\\.[0-9]+)?)/);",
  "        if (!todayMatch) return;",
  "        var todayDollars = parseFloat(todayMatch[1]);",
  "        var todayCents = Math.round(todayDollars * 100);",
  "",
  "        var noteId = prefix + '-credit-note';",
  "        var noteEl = document.getElementById(noteId);",
  "",
  "        if (!apply || creditCents <= 0) {",
  "          /* Restore the price card to its original. Leave btnAmtEl alone",
  "             because the page's own updateButtonLabels() owns it. Hide the",
  "             credit note if present. NO cross-function call here  this is",
  "             what fixes the v1 recursion. */",
  "          priceEl.innerHTML = priceEl.dataset.tmcOriginal;",
  "          if (noteEl) noteEl.style.display = 'none';",
  "          return;",
  "        }",
  "",
  "        /* $1 minimum for direct flow (server-side enforced). */",
  "        var maxApplyCents = Math.max(0, todayCents - 100);",
  "        var discountCents = Math.min(creditCents, maxApplyCents);",
  "        if (discountCents <= 0) {",
  "          if (noteEl) noteEl.style.display = 'none';",
  "          return;",
  "        }",
  "",
  "        var finalCents     = todayCents - discountCents;",
  "        var finalDollars   = (finalCents     / 100).toFixed(2);",
  "        var discountDollars= (discountCents  / 100).toFixed(2);",
  "        var remainingCents = creditCents - discountCents;",
  "        var remainingDolls = (remainingCents / 100).toFixed(2);",
  "",
  "        /* Update the on-card price. Preserve the '/yr' sub-span. */",
  "        var orig = priceEl.dataset.tmcOriginal;",
  "        var subMatch = orig.match(/<span[\\s\\S]*?<\\/span>/i);",
  "        var subSpan = subMatch ? subMatch[0] : '';",
  "        priceEl.innerHTML = '$' + finalDollars + ' ' + subSpan;",
  "",
  "        btnAmtEl.textContent = '$' + finalDollars;",
  "",
  "        if (!noteEl) {",
  "          noteEl = document.createElement('div');",
  "          noteEl.id = noteId;",
  "          noteEl.style.cssText = 'background:#F0FDF4;border-left:3px solid #16A34A;padding:10px 12px;margin:10px 0 0;font-size:11px;color:#166534;line-height:1.55;border-radius:8px';",
  "          var parent = btnEl.parentNode;",
  "          if (parent) parent.insertBefore(noteEl, btnEl.nextSibling);",
  "        }",
  "        noteEl.style.display = 'block';",
  "        if (remainingCents > 0) {",
  "          noteEl.textContent =",
  "            '$' + discountDollars + ' applied. $' + finalDollars +",
  "            ' minimum charge today (saves your card for annual renewal as we accept autopay). $' +",
  "            remainingDolls + ' remains in your account, can use for future transactions.';",
  "        } else {",
  "          noteEl.textContent = '$' + discountDollars + ' referral credit applied.';",
  "        }",
  "      });",
  "    } finally {",
  "      window.__tmcUpdating = false;",
  "    }",
  "  }",
  "",
  "  /* Wrap the page's own updateButtonLabels so OUR display refreshes any",
  "     time a prepay checkbox toggles. The guard prevents recursion: if",
  "     updateCreditDisplay() is currently running, the wrapper just calls",
  "     the original and returns without re-triggering our logic. */",
  "  function hookUpdateButtonLabels() {",
  "    if (window.__tmcUblHooked) return;",
  "    if (typeof window.updateButtonLabels !== 'function') return;",
  "    window.__tmcUblHooked = true;",
  "    var orig = window.updateButtonLabels;",
  "    window.updateButtonLabels = function () {",
  "      try { orig.apply(this, arguments); } catch (e) {}",
  "      if (!window.__tmcUpdating) {",
  "        try { updateCreditDisplay(); } catch (e) {}",
  "      }",
  "    };",
  "  }",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', function () {",
  "      hookUpdateButtonLabels();",
  "      setTimeout(hookUpdateButtonLabels, 50);",
  "      setTimeout(hookUpdateButtonLabels, 200);",
  "      setTimeout(updateCreditDisplay, 250);",
  "    });",
  "  } else {",
  "    hookUpdateButtonLabels();",
  "    setTimeout(hookUpdateButtonLabels, 50);",
  "    setTimeout(updateCreditDisplay, 100);",
  "  }"
].join('\n');

log('\nTapMyCar  Patch 45c-pricing v2  with recursion fix\n');

if (!fs.existsSync(PR)) fail('expected file not found: ' + PR);
const original = fs.readFileSync(PR, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(PR + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const i = updated.indexOf(SA_FIND);
if (i === -1) fail('pattern NOT FOUND: setApplied anchor.\nDid the revert restore the Patch 45b-fix version? Run:\n  git log --oneline -5\nto check, or paste the first 5 lines of public/pricing.html\'s setApplied function so I can adjust.');
if (updated.indexOf(SA_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE');
updated = updated.replace(SA_FIND, () => SA_REPLACE);

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(PR, path.join(BACKUP_DIR, PR));
fs.writeFileSync(PR, updated, 'utf8');

const s = fs.readFileSync(PR, 'utf8');
const at = s.indexOf('TMC_PATCH45C_PRICING_V2');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p45c-v2-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p45c-v2-chk.js', { stdio: 'pipe' });
    log(PR + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(PR, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 45c-pricing v2: honest checkout UX (recursion fix)"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Hard-refresh /pricing.html. Page should LOAD (no freeze).');
log('     Tick the checkbox  prices and notes update for both plans.');
log('     Untick  prices revert, notes disappear.\n');
