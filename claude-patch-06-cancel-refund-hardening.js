#!/usr/bin/env node
/* ============================================================================
 * claude-patch-06-cancel-refund-hardening.js
 * ----------------------------------------------------------------------------
 * Closes the last silent-skip on the Cancel button (api/cancel-subscription.js).
 *
 * CAUSE: the refund is created with `charge: invoice.charge`, and only fires if
 * that field has a value. On newer Stripe API versions invoice.charge is often
 * empty (the reference moved to the PaymentIntent). When it's empty, the refund
 * is silently skipped - eligible person, no refund, no error.
 *
 * FIX: also capture invoice.payment_intent, and when the charge id is missing,
 * refund by payment_intent instead. Stripe's refunds.create accepts either. If
 * a charge id IS present, behavior is unchanged (no regression).
 *
 * NOTE ON AMOUNTS: the code also only treats a charge as refundable if it's
 * EXACTLY $9.99/$19.99. That's correct as long as you don't add sales tax or
 * discounts. If you ever do, tell me and I'll loosen that too - I'm leaving it
 * exact here so this patch can't accidentally match the wrong charge.
 *
 * SCOPE: api/cancel-subscription.js only. Serverless -> git push redeploys it.
 * No cap sync, no rebuild, no ?v bump, no root mirror.
 *
 * SAFE / IDEMPOTENT: timestamped backup, UTF-8 no-BOM, skips if already patched
 * (marker TMC_PATCH06), requires all 4 anchors to match exactly once each else
 * aborts & restores, node --check on the result with restore-on-failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join('api', 'cancel-subscription.js');
const MARKER = 'TMC_PATCH06';

// [anchor, replacement-builder] pairs. Each anchor must match exactly once.
const edits = [
  {
    name: 'findLastAnnualInvoice return: add payment_intent',
    re: /charge_id:\s*inv\.charge,/,
    build: (m) => m + '\n      payment_intent: inv.payment_intent, // TMC_PATCH06 fallback when charge is empty'
  },
  {
    name: 'computeEligibility last_invoice: add payment_intent',
    re: /charge_id:\s*last\.charge_id,/,
    build: (m) => m + '\n      payment_intent: last.payment_intent, // TMC_PATCH06'
  },
  {
    name: 'refund gate: allow charge OR payment_intent',
    re: /&&\s*elig\.last_invoice\.charge_id\)\s*\{/,
    build: () => '&& (elig.last_invoice.charge_id || elig.last_invoice.payment_intent)) { // TMC_PATCH06'
  },
  {
    name: 'refunds.create: refund by charge or payment_intent',
    re: /const refund = await stripe\.refunds\.create\(\{[\s\S]*?invoice_id:\s*elig\.last_invoice\.invoice_id\s*\}\s*\}\s*\)\s*;/,
    build: () => [
      '// TMC_PATCH06: refund by charge when present, else by payment_intent',
      '        // (newer Stripe API versions often leave invoice.charge empty).',
      '        const __refundParams = {',
      '          amount: elig.refund_cents,',
      "          reason: 'requested_by_customer',",
      '          metadata: {',
      '            user_id: user.id,',
      "            policy: '14_day_annual_refund',",
      '            service_fee_cents: String(SERVICE_FEE_CENTS),',
      '            invoice_id: elig.last_invoice.invoice_id',
      '          }',
      '        };',
      '        if (elig.last_invoice.charge_id) __refundParams.charge = elig.last_invoice.charge_id;',
      '        else __refundParams.payment_intent = elig.last_invoice.payment_intent;',
      '        const refund = await stripe.refunds.create(__refundParams);'
    ].join('\n')
  }
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-06-cancel-refund-hardening.js');
console.log('------------------------------------------');

if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found (nothing changed).'); process.exit(1); }
const original = fs.readFileSync(FILE, 'utf8');
if (original.indexOf(MARKER) !== -1) { console.log(FILE + ': already patched (skip).'); process.exit(0); }

// verify every anchor matches exactly once BEFORE writing anything
for (const e of edits) {
  const count = (original.match(new RegExp(e.re, 'g')) || []).length;
  if (count !== 1) { console.log('ABORT - anchor "' + e.name + '" matched ' + count + ' times (expected 1). Nothing changed.'); process.exit(1); }
}

const backup = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, backup);
try {
  let updated = original;
  for (const e of edits) { updated = updated.replace(e.re, function (m) { return e.build(m); }); }

  if (updated.indexOf(MARKER) === -1 || !/__refundParams/.test(updated)) throw new Error('post-edit sanity check failed');

  fs.writeFileSync(FILE, Buffer.from(updated, 'utf8')); // UTF-8, no BOM
  try { execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' }); }
  catch (e) { fs.copyFileSync(backup, FILE); console.log(FILE + ': FAILED node --check -> restored.'); console.log('   ' + String(e.message || e)); process.exit(1); }

  console.log(FILE + ': payment_intent fallback added (4 edits).  (backup: ' + path.basename(backup) + ')');
  console.log('------------------------------------------');
  console.log('Done. git add/commit/push -> Vercel redeploys. No cap sync / rebuild.');
  process.exit(0);
} catch (err) {
  fs.copyFileSync(backup, FILE);
  console.log(FILE + ': FAILED -> restored  (' + String(err.message || err) + ')');
  process.exit(1);
}
