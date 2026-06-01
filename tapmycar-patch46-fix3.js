/* ============================================================================
 * TapMyCar  Patch 46-fix3  partial credit consumption (split last row)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch46-fix3.js
 *
 * Bug fix only. No new pages, no new endpoints.
 *
 * The problem: when credit rows are larger than the amount needed (e.g. four
 * $3 rows for a $9.99 purchase), the FIFO loop collects all 4 rows ($12),
 * the free-flow branch consumes all 4 rows, and the user loses $2.01 of
 * credit they were told would remain. The renew.html UI math said "$2.01
 * remains" but the database said $0.
 *
 * The fix: in the free-flow consumption step, instead of marking ALL
 * collected rows 'consumed', we:
 *   1. Mark fully-used rows 'consumed' as before.
 *   2. For the LAST row whose value exceeds the remaining need, split it:
 *      - Mark the original row 'consumed' (it served as a partial)
 *      - Insert a NEW 'available' row for the leftover amount
 *
 * Example:
 *   Before: row1=$3, row2=$3, row3=$3, row4=$3 (all available). Apply $9.99.
 *   After:  row1=consumed, row2=consumed, row3=consumed, row4=consumed,
 *           row5(new)=available $2.01
 *   Net result: user has $2.01 spendable, matching the UI promise.
 *
 * Why split-with-new-row instead of partial-amount-on-original-row?
 *   - Audit trail: the original row keeps its full credit_amount and shows",
 *     it was consumed (transaction history stays clean).
 *   - The new row links back to a fresh applied_at = now and gets a new id,
 *     so its "where this credit came from" is reconstructable (the original
 *     row id can be stored in revoke_reason if needed; not added in fix3
 *     because we don't have a column for it and it isn't queried anywhere).
 *
 * Only the free-flow branch is touched. The Stripe-checkout-with-discount
 * branch already passes the discount amount as a line-item adjustment, and
 * the webhook marks rows consumed after the payment completes; that path
 * has the SAME bug and ALSO needs the same fix. Both paths updated in this
 * patch.
 *
 * Files modified:
 *   1. api/create-checkout.js  free-flow branch: split-last-row consumption.
 *   2. api/stripe-webhook.js   on checkout.session.completed: same logic
 *                              when marking rows consumed from metadata.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH46_FIX3.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH46_FIX3';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch46-fix3-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC = path.join('api', 'create-checkout.js');
const WH = path.join('api', 'stripe-webhook.js');

/* ========================================================================
 * EDIT 1  api/create-checkout.js  free-flow consumption block
 * ----------------------------------------------------------------------
 * Anchor: the existing "Mark the consumed credits" block. Replace the
 * blanket .update() with the split-last-row routine. _tmcCreditCents
 * (total collected, in cents) and _tmcCreditUsedCents (what was actually
 * applied, in cents) are both already in scope. The difference between
 * them is what should be re-issued as a new available row.
 * ======================================================================*/

const CC_FIND = [
  "        /* Mark the consumed credits in the referrals table. */",
  "        if (_tmcCreditRowIds.length > 0) {",
  "          await supabase.from('referrals').update({",
  "            status: 'consumed',",
  "            consumed_at: new Date().toISOString()",
  "          }).in('id', _tmcCreditRowIds);",
  "        }"
].join('\n');

const CC_REPLACE = [
  "        /* TMC_PATCH46_FIX3: split-last-row consumption. _tmcCreditCents",
  "           is what we COLLECTED, _tmcCreditUsedCents is what was actually",
  "           APPLIED. The difference is leftover that must come back to the",
  "           user as a new 'available' row. Without this, a $9.99 renewal",
  "           that collects 4x$3 rows ($12) would burn all $12 even though",
  "           only $9.99 was needed.",
  "           Mark all collected rows consumed (clean audit trail), then",
  "           insert a fresh 'available' row for the leftover amount. */",
  "        if (_tmcCreditRowIds.length > 0) {",
  "          await supabase.from('referrals').update({",
  "            status: 'consumed',",
  "            consumed_at: new Date().toISOString()",
  "          }).in('id', _tmcCreditRowIds);",
  "          const _tmcLeftoverCents = _tmcCreditCents - _tmcCreditUsedCents;",
  "          if (_tmcLeftoverCents > 0) {",
  "            const leftoverDollars = (_tmcLeftoverCents / 100).toFixed(2);",
  "            await supabase.from('referrals').insert({",
  "              referrer_user_id: user_id,",
  "              referred_user_id: null,",
  "              referral_code:    'LEFTOVER',",
  "              status:           'available',",
  "              credit_amount:    parseFloat(leftoverDollars),",
  "              /* paid_at is required for FIFO ordering; use now so this",
  "                 leftover gets used LAST among future purchases (we want",
  "                 older real referral rows to be spent first). Wait, ",
  "                 actually FIFO order='asc' means OLDEST paid_at first, so",
  "                 setting paid_at=now makes this the youngest = last. */",
  "              paid_at:          new Date().toISOString(),",
  "              available_at:     new Date().toISOString(),",
  "              applied_at:       new Date().toISOString()",
  "            });",
  "          }",
  "        }"
].join('\n');

/* ========================================================================
 * EDIT 2  api/stripe-webhook.js  same split logic on checkout.session.completed
 * ----------------------------------------------------------------------
 * When the Stripe-with-discount path completes, the webhook marks the
 * collected rows consumed. It has the same bug because it just .update()s
 * every row id from metadata.referral_credit_row_ids. We add the same
 * split-leftover insert.
 *
 * The webhook needs both the COLLECTED total (sum of credit_amount across
 * the rows whose ids are in metadata) and the APPLIED amount (in metadata
 * referral_credit_applied, in cents). The collected total has to be fetched
 * from the DB because it isn't in metadata.
 * ======================================================================*/

const WH_FIND = [
  "        // ─── TMC_PATCH45B: mark consumed referral credits ───────",
  "        try {",
  "          const m = session.metadata || {};",
  "          const ids = (m.referral_credit_row_ids || '').split(',').filter(Boolean);",
  "          if (ids.length > 0) {",
  "            await supabase.from('referrals').update({",
  "              status: 'consumed',",
  "              consumed_at: new Date().toISOString(),",
  "              consumed_order_id: orderRow ? orderRow.id : null",
  "            }).in('id', ids).in('status', ['available','pending']);",
  "            console.log('p45b: marked ' + ids.length + ' referral credit(s) consumed');",
  "          }",
  "        } catch (e) {",
  "          console.warn('p45b: credit consume failed (non-fatal):', e && e.message);",
  "        }"
].join('\n');

const WH_REPLACE = [
  "        // ─── TMC_PATCH46_FIX3: mark consumed + split leftover ───",
  "        try {",
  "          const m = session.metadata || {};",
  "          const ids = (m.referral_credit_row_ids || '').split(',').filter(Boolean);",
  "          const appliedCents = parseInt(m.referral_credit_applied || '0', 10) || 0;",
  "          if (ids.length > 0) {",
  "            /* Fetch the rows' credit_amount so we can compute leftover.",
  "               This must happen BEFORE the update flips them to consumed. */",
  "            const { data: rowDetails } = await supabase",
  "              .from('referrals')",
  "              .select('id, credit_amount')",
  "              .in('id', ids);",
  "            const collectedCents = (rowDetails || []).reduce(function (sum, r) {",
  "              return sum + Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "            }, 0);",
  "",
  "            await supabase.from('referrals').update({",
  "              status: 'consumed',",
  "              consumed_at: new Date().toISOString(),",
  "              consumed_order_id: orderRow ? orderRow.id : null",
  "            }).in('id', ids).in('status', ['available','pending']);",
  "",
  "            const leftoverCents = collectedCents - appliedCents;",
  "            if (leftoverCents > 0) {",
  "              const leftoverDollars = (leftoverCents / 100).toFixed(2);",
  "              await supabase.from('referrals').insert({",
  "                referrer_user_id: user_id,",
  "                referred_user_id: null,",
  "                referral_code:    'LEFTOVER',",
  "                status:           'available',",
  "                credit_amount:    parseFloat(leftoverDollars),",
  "                paid_at:          new Date().toISOString(),",
  "                available_at:     new Date().toISOString(),",
  "                applied_at:       new Date().toISOString()",
  "              });",
  "              console.log('p46-fix3: issued leftover available row $' + leftoverDollars);",
  "            }",
  "            console.log('p46-fix3: consumed ' + ids.length + ' rows for $' + (appliedCents / 100).toFixed(2));",
  "          }",
  "        } catch (e) {",
  "          console.warn('p46-fix3: credit consume failed (non-fatal):', e && e.message);",
  "        }"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 46-fix3  partial credit consumption (split last row)\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function patchFile(file, edits) {
  if (!fs.existsSync(file)) fail('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + file + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + file + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  backupAndWrite(file, original, updated);
  log(file + ': patched');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

try {
  if (patchFile(CC, [
    { label: 'create-checkout: free-flow split-last-row', find: CC_FIND, replace: CC_REPLACE }
  ])) {
    execSync('node --check "' + CC + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(WH, [
    { label: 'stripe-webhook: consume + leftover insert', find: WH_FIND, replace: WH_REPLACE }
  ])) {
    execSync('node --check "' + WH + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 46-fix3: partial credit consumption"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test: take a fresh $12 of credit (4 rows of $3), do a $9.99');
  log('     renewal with checkbox ticked  expect AFTER:');
  log('       - 4 rows status=consumed (originals)');
  log('       - 1 NEW row status=available, credit_amount=2.01,');
  log('         referral_code=LEFTOVER');
  log('     Settings should show: AVAILABLE $2.01.\n');
}
