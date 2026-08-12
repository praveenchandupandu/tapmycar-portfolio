#!/usr/bin/env node
/* ============================================================================
 * claude-patch-22-refund-tax-tolerance.js
 * ----------------------------------------------------------------------------
 * PROBLEM
 *   api/cancel-subscription.js decides which Stripe invoice is "the annual
 *   subscription charge" with an EXACT amount match:
 *
 *       return inv.amount_paid === annualCents;   // 999 or 1999
 *
 *   Stripe Tax adds sales tax on top, so a Connecticut customer on Standard
 *   actually paid 1063 (= 999 + 64 tax), not 999. No invoice matches, so
 *   computeEligibility() returns 'no_annual_charge_yet' and the customer is
 *   wrongly refused a refund inside the 14-day window.
 *
 * FIX
 *   Replace the exact match with isAnnualCharge(), which accepts an invoice if
 *   ANY of these is true:
 *     1. amount_paid === base price            (untaxed — old behaviour, kept)
 *     2. an invoice LINE ITEM is priced at the base price  (most reliable:
 *        the plan's own price, before tax and before referral credits)
 *     3. amount_paid minus the invoice's reported tax === base price
 *     4. amount_paid is between base and base + 20%  (safety net; 20% is far
 *        above any US sales tax, and well below the next plan's price)
 *
 *   The refund amount itself is unchanged: amount_paid - $1 service fee, so a
 *   taxed customer gets their tax back too.
 *
 *   api/cancel-subscription-preview.js imports computeEligibility from this
 *   same file, so the "Cancel & get $X back" preview is fixed by the same edit.
 *
 * SCOPE: api/ only. Deploys via git push to Vercel. Does NOT touch the
 * approved Android bundle (no public/, no android/, no capacitor sync needed).
 *
 * SAFE / IDEMPOTENT: timestamped backup, UTF-8 no-BOM, latin1 byte
 * preservation, both anchors must match exactly once, node --check with
 * automatic restore on failure, re-running is a no-op.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TARGET = path.join('api', 'cancel-subscription.js');
const MARKER = 'TMC_PATCH22_TAX';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function die(msg) {
  console.error('\n  ABORTED: ' + msg + '\n  Nothing was changed.\n');
  process.exit(1);
}

// ── Pre-flight ──────────────────────────────────────────────────────────────
if (!fs.existsSync(TARGET)) {
  die('Cannot find ' + TARGET + '. Run this from the tapmycar project root.');
}

// latin1 preserves every byte exactly (including any UTF-8 multi-byte
// characters like the — dashes in this file) through read -> edit -> write.
let src = fs.readFileSync(TARGET, 'latin1');

if (src.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' found in ' + TARGET + ').');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Anchor 1: the doc comment right above findLastAnnualInvoice ─────────────
const ANCHOR_HELPERS = '/**\n * Find the most recent paid invoice on a subscription that is an';

// ── Anchor 2: the exact-match filter body ───────────────────────────────────
const ANCHOR_FILTER =
  "        // Amount must match annual price exactly (rules out partial charges,\n" +
  "        // prepay bundles, sticker-only charges, etc).\n" +
  "        return inv.amount_paid === annualCents;\n";

function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const c1 = countOf(src, ANCHOR_HELPERS);
const c2 = countOf(src, ANCHOR_FILTER);
if (c1 !== 1) die('helper anchor matched ' + c1 + ' times (expected exactly 1) in ' + TARGET);
if (c2 !== 1) die('filter anchor matched ' + c2 + ' times (expected exactly 1) in ' + TARGET);

// ── The new code ────────────────────────────────────────────────────────────
const HELPERS =
'/**\n' +
' * ' + MARKER + ': tolerant matching for "is this the annual subscription charge?"\n' +
' *\n' +
' * Checkout runs Stripe Tax, so a taxed customer pays base price + sales tax.\n' +
' * The old exact match (amount_paid === 999) never matched those invoices, so\n' +
' * taxed customers were wrongly told they had no refundable charge.\n' +
' */\n' +
'const MAX_TAX_RATE = 0.20; // 20% ceiling -- above any US sales tax, below the next plan up\n' +
'\n' +
'// Total tax on an invoice. Older Stripe API versions expose inv.tax; newer\n' +
'// ones use an array (total_tax_amounts / total_taxes). Handle all shapes.\n' +
'function invoiceTaxCents(inv) {\n' +
'  if (!inv) return 0;\n' +
'  if (typeof inv.tax === \'number\' && inv.tax >= 0) return inv.tax;\n' +
'  const buckets = [inv.total_tax_amounts, inv.total_taxes];\n' +
'  for (let b = 0; b < buckets.length; b++) {\n' +
'    const arr = buckets[b];\n' +
'    if (Array.isArray(arr) && arr.length) {\n' +
'      return arr.reduce(function (t, x) {\n' +
'        return t + ((x && typeof x.amount === \'number\') ? x.amount : 0);\n' +
'      }, 0);\n' +
'    }\n' +
'  }\n' +
'  return 0;\n' +
'}\n' +
'\n' +
'// True if a line on this invoice is the plan itself, priced at the base\n' +
'// annual price. Line amounts are pre-tax, so this is the most reliable test.\n' +
'function hasAnnualLineItem(inv, annualCents) {\n' +
'  const lines = (inv && inv.lines && Array.isArray(inv.lines.data)) ? inv.lines.data : [];\n' +
'  for (let i = 0; i < lines.length; i++) {\n' +
'    const li = lines[i];\n' +
'    if (!li) continue;\n' +
'    if (typeof li.amount === \'number\' && li.amount === annualCents) return true;\n' +
'    if (li.price && typeof li.price.unit_amount === \'number\' && li.price.unit_amount === annualCents) return true;\n' +
'    if (li.plan && typeof li.plan.amount === \'number\' && li.plan.amount === annualCents) return true;\n' +
'  }\n' +
'  return false;\n' +
'}\n' +
'\n' +
'function isAnnualCharge(inv, annualCents) {\n' +
'  if (!inv || !annualCents) return false;\n' +
'  const paid = (typeof inv.amount_paid === \'number\') ? inv.amount_paid : 0;\n' +
'\n' +
'  // 1. Untaxed customer -- exactly the base price (original behaviour).\n' +
'  if (paid === annualCents) return true;\n' +
'\n' +
'  // 2. A line item priced at the base annual price (pre-tax, pre-credit).\n' +
'  if (hasAnnualLineItem(inv, annualCents)) return true;\n' +
'\n' +
'  // 3. Strip the invoice-level tax and see if the base price is left.\n' +
'  if (paid - invoiceTaxCents(inv) === annualCents) return true;\n' +
'\n' +
'  // 4. Safety net: base price plus a plausible amount of sales tax.\n' +
'  const maxTax = Math.ceil(annualCents * MAX_TAX_RATE);\n' +
'  return paid > annualCents && paid <= annualCents + maxTax;\n' +
'}\n' +
'\n';

const NEW_FILTER =
  "        // " + MARKER + ": tolerant match -- base price, or base price + sales tax\n" +
  "        // (Stripe Tax), or the plan's own line item. Still rules out partial\n" +
  "        // charges, prepay bundles and sticker-only charges.\n" +
  "        return isAnnualCharge(inv, annualCents);\n";

// ── Guard: inserted text must be pure ASCII ────────────────────────────────
// We write with latin1 to preserve the file's existing UTF-8 bytes exactly.
// That round-trip is lossless for what's already there, but any non-ASCII
// character in NEW text would be squashed to a single wrong byte. So assert.
if (/[^\x00-\x7F]/.test(HELPERS + NEW_FILTER)) {
  die('internal error: patch tried to insert non-ASCII text.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
const backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);

let out = src.replace(ANCHOR_HELPERS, function () { return HELPERS + ANCHOR_HELPERS; });
out = out.replace(ANCHOR_FILTER, function () { return NEW_FILTER; });

fs.writeFileSync(TARGET, out, 'latin1'); // latin1 out = byte-identical round-trip, no BOM

// ── Verify ──────────────────────────────────────────────────────────────────
try {
  execFileSync(process.execPath, ['--check', TARGET], { stdio: 'pipe' });
} catch (e) {
  fs.copyFileSync(backup, TARGET);
  die('node --check failed on the patched file. Original restored from ' + backup +
      '\n  ' + String((e.stderr || e.stdout || e.message)).trim());
}

const check = fs.readFileSync(TARGET, 'latin1');
if (check.indexOf(MARKER) === -1 ||
    check.indexOf('return isAnnualCharge(inv, annualCents);') === -1 ||
    check.indexOf('return inv.amount_paid === annualCents;') !== -1) {
  fs.copyFileSync(backup, TARGET);
  die('post-write verification failed. Original restored from ' + backup);
}

console.log('\n  OK  ' + TARGET + ' patched.');
console.log('      backup: ' + backup);
console.log('      Taxed annual charges are now recognised, so 14-day refunds work.');
console.log('      api/cancel-subscription-preview.js is fixed too (shared function).');
console.log('      Backend only — your approved Android bundle is untouched.\n');
