/* ============================================================================
 * TapMyCar  Patch 45c-pricing  honest checkout UX on pricing page
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45c-pricing-ux.js
 *
 * When the user ticks "Apply referral credit at checkout" on /pricing.html
 * with referral credit available, this patch makes the page honestly show
 * what they'll actually pay:
 *
 *   - The "$X.XX today" price on each plan card updates to the discounted
 *     amount.
 *   - The "Get Standard / Get Premium" button label updates to the
 *     discounted amount.
 *   - A small green note appears below the plan card explaining:
 *       * If credit was MORE than (plan price - $1):
 *           "$X.XX applied. $1.00 minimum charge today (saves your card
 *           for annual renewal as we accept autopay). $Y.YY remains in
 *           your account, can use for future transactions."
 *       * If credit was LESS than the plan price:
 *           "$X.XX referral credit applied."
 *   - Unticking the checkbox restores the original prices and removes the
 *     notes.
 *   - Toggling the prepay checkbox on each plan recalculates correctly.
 *
 * Backend behavior is unchanged. Server-side enforcement and $1-minimum
 * direct-flow rule from Patch 45b are still in effect; this patch only
 * makes the pricing page accurately reflect what they'll be charged.
 *
 * One file modified: public/pricing.html.
 *
 * SAFE TO RE-RUN: skipped if file already contains TMC_PATCH45C_PRICING.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45C_PRICING';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45c-pricing-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const PR = path.join('public', 'pricing.html');

/* ========================================================================
 * EDIT 1  pricing.html  expand setApplied() in the Patch-45b-fix IIFE so
 * it also updates the per-plan price, button, and contextual note.
 *
 * The anchor is the existing 45b-fix setApplied function. We rewrite its
 * body to (a) call the legacy banner toggle as before, (b) trigger our
 * new per-plan UI update.
 * ======================================================================*/

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
  "  /* TMC_PATCH45C_PRICING: cache the credit so updateCreditDisplay() can read it. */",
  "  window.__tmcCreditDollars = 0;",
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
  "  /* Per-plan dynamic price/button/note updates. Reads:",
  "       - window.__tmcApply (true if checkbox ticked)",
  "       - window.__tmcCreditDollars (the user's available credit)",
  "       - the current button label (which encodes the prepay-aware base price)",
  "     Writes:",
  "       - #std-price / #prem-price innerHTML  reflect discounted today price",
  "       - #std-btn-amt / #prem-btn-amt textContent  same",
  "       - a green note injected below each affected plan card */",
  "  function updateCreditDisplay() {",
  "    var apply = !!window.__tmcApply;",
  "    var creditCents = Math.round((window.__tmcCreditDollars || 0) * 100);",
  "    ['standard','premium'].forEach(function (plan) {",
  "      var prefix = plan === 'standard' ? 'std' : 'prem';",
  "      var priceEl  = document.getElementById(prefix + '-price');",
  "      var btnAmtEl = document.getElementById(prefix + '-btn-amt');",
  "      var btnEl    = document.getElementById(prefix + '-btn');",
  "      if (!priceEl || !btnAmtEl || !btnEl) return;",
  "",
  "      /* Save the originals once so we can restore them on untick. */",
  "      if (typeof priceEl.dataset.tmcOriginal === 'undefined') {",
  "        priceEl.dataset.tmcOriginal = priceEl.innerHTML;",
  "      }",
  "      /* The button amount is rewritten by updateButtonLabels() every time",
  "         the prepay checkbox toggles. That's our source of truth for the",
  "         current 'today' price for this plan, prepay-aware. */",
  "      var btnText = (btnAmtEl.textContent || '').trim();",
  "      var todayMatch = btnText.match(/\\$([0-9]+(?:\\.[0-9]+)?)/);",
  "      if (!todayMatch) return;",
  "      var todayDollars = parseFloat(todayMatch[1]);",
  "      var todayCents = Math.round(todayDollars * 100);",
  "",
  "      /* Find/remove the credit note for this plan. */",
  "      var noteId = prefix + '-credit-note';",
  "      var noteEl = document.getElementById(noteId);",
  "",
  "      if (!apply || creditCents <= 0) {",
  "        /* Restore the original price display. The button label is restored",
  "           by updateButtonLabels() on its own (next prepay-toggle or page",
  "           load); we proactively restore it too for the immediate untick. */",
  "        priceEl.innerHTML = priceEl.dataset.tmcOriginal;",
  "        /* Rebuild the original button amount text from the prepay state, by",
  "           calling the page's own updateButtonLabels if present. */",
  "        if (typeof window.updateButtonLabels === 'function') {",
  "          try { window.updateButtonLabels(); } catch (e) {}",
  "        }",
  "        if (noteEl) noteEl.style.display = 'none';",
  "        return;",
  "      }",
  "",
  "      /* For direct flow, $1 minimum charge stays (server-side enforced by",
  "         Patch 45b). Compute the maximum applicable discount accordingly. */",
  "      var maxApplyCents = Math.max(0, todayCents - 100);",
  "      var discountCents = Math.min(creditCents, maxApplyCents);",
  "      if (discountCents <= 0) {",
  "        /* Nothing to apply (e.g. todayCents already at $1 or below). */",
  "        if (noteEl) noteEl.style.display = 'none';",
  "        return;",
  "      }",
  "",
  "      var finalCents     = todayCents - discountCents;",
  "      var finalDollars   = (finalCents     / 100).toFixed(2);",
  "      var discountDollars= (discountCents  / 100).toFixed(2);",
  "      var remainingCents = creditCents - discountCents;",
  "      var remainingDolls = (remainingCents / 100).toFixed(2);",
  "",
  "      /* Update the on-card price. Preserve the '/yr' sub-span. */",
  "      var orig = priceEl.dataset.tmcOriginal;",
  "      var subMatch = orig.match(/<span[\\s\\S]*?<\\/span>/i);",
  "      var subSpan = subMatch ? subMatch[0] : '';",
  "      priceEl.innerHTML = '$' + finalDollars + ' ' + subSpan;",
  "",
  "      /* Update the button label. */",
  "      btnAmtEl.textContent = '$' + finalDollars;",
  "",
  "      /* Insert/update the note below the button. */",
  "      if (!noteEl) {",
  "        noteEl = document.createElement('div');",
  "        noteEl.id = noteId;",
  "        noteEl.style.cssText = 'background:#F0FDF4;border-left:3px solid #16A34A;padding:10px 12px;margin:10px 0 0;font-size:11px;color:#166534;line-height:1.55;border-radius:8px';",
  "        var parent = btnEl.parentNode;",
  "        if (parent) parent.insertBefore(noteEl, btnEl.nextSibling);",
  "      }",
  "      noteEl.style.display = 'block';",
  "      if (remainingCents > 0) {",
  "        noteEl.textContent =",
  "          '$' + discountDollars + ' applied. $' + finalDollars +",
  "          ' minimum charge today (saves your card for annual renewal as we accept autopay). $' +",
  "          remainingDolls + ' remains in your account, can use for future transactions.';",
  "      } else {",
  "        noteEl.textContent = '$' + discountDollars + ' referral credit applied.';",
  "      }",
  "    });",
  "  }",
  "",
  "  /* Wrap the page's own updateButtonLabels so OUR display refreshes any",
  "     time a prepay checkbox toggles  the page rewrites the button text",
  "     to the prepay-aware 'today' amount, then our code re-applies the",
  "     credit on top. We hook it after the main script has loaded. */",
  "  function hookUpdateButtonLabels() {",
  "    if (window.__tmcUblHooked) return;",
  "    if (typeof window.updateButtonLabels !== 'function') return;",
  "    window.__tmcUblHooked = true;",
  "    var orig = window.updateButtonLabels;",
  "    window.updateButtonLabels = function () {",
  "      try { orig.apply(this, arguments); } catch (e) {}",
  "      try { updateCreditDisplay(); } catch (e) {}",
  "    };",
  "  }",
  "  /* The main script runs at end of body; hook on DOMContentLoaded.",
  "     Fall back to a short retry loop in case the main script hasn't run yet. */",
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

/* ========================================================================
 * EDIT 2  same IIFE: when inject() runs, also call setApplied(false,
 * creditDollars) so the cached credit value is stored even before any tick.
 * That way the first tick has the right number to work with.
 *
 * The existing 45b-fix code already does setApplied(false, creditDollars).
 * We just need to ensure updateCreditDisplay() is also called once at the
 * end of inject() so the page starts in a consistent state, even if the
 * user has the checkbox unticked. That's done implicitly by setApplied
 * calling updateCreditDisplay above. No second edit needed.
 * ==========================================================================*/

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 45c-pricing  honest checkout UX on pricing page\n');

if (!fs.existsSync(PR)) fail('expected file not found: ' + PR);
const original = fs.readFileSync(PR, 'utf8');
if (original.indexOf(MARKER) !== -1) {
  log(PR + ': skip (already patched)\n');
  process.exit(0);
}

const wasCRLF = original.indexOf('\r\n') !== -1;
let updated = original.replace(/\r\n/g, '\n');

const i = updated.indexOf(SA_FIND);
if (i === -1) fail('pattern NOT FOUND: setApplied anchor. Nothing was written. Did Patch 45b-fix run first?');
if (updated.indexOf(SA_FIND, i + 1) !== -1) fail('pattern NOT UNIQUE');
updated = updated.replace(SA_FIND, () => SA_REPLACE);

if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');

fs.mkdirSync(path.join(BACKUP_DIR, 'public'), { recursive: true });
fs.copyFileSync(PR, path.join(BACKUP_DIR, PR));
fs.writeFileSync(PR, updated, 'utf8');

/* syntax-check the IIFE */
const s = fs.readFileSync(PR, 'utf8');
const at = s.indexOf('TMC_PATCH45B_FIX: pricing-page');
if (at !== -1) {
  const a = s.lastIndexOf('<script>', at) + 8;
  const b = s.indexOf('</script>', at);
  fs.writeFileSync('/tmp/p45c-pricing-chk.js', s.slice(a, b));
  try {
    execSync('node --check /tmp/p45c-pricing-chk.js', { stdio: 'pipe' });
    log(PR + ': patched, node --check OK');
  } catch (e) {
    fs.writeFileSync(PR, original, 'utf8');
    fail('node --check FAILED  file restored.\n' + String(e.stderr || e.message));
  }
}

log('\nDone.\n');
log('NEXT STEPS:');
log('  1. git add -A');
log('  2. git commit -m "Patch 45c-pricing: honest checkout UX"');
log('  3. git push  (wait ~60s for Vercel)');
log('  4. Hard-refresh /pricing.html. With $12 credit AND checkbox ticked:');
log('       - Standard price: $9.99 -> $1.00, button "Get Standard - $1.00"');
log('         note: "$8.99 applied. $1.00 minimum charge today (saves your');
log('         card for annual renewal as we accept autopay). $3.00 remains');
log('         in your account, can use for future transactions."');
log('       - Premium price: $24.99 -> $12.99, button "Get Premium - $12.99"');
log('         note: "$12.00 referral credit applied."');
log('       Untick the checkbox: prices and buttons restore, notes disappear.\n');
