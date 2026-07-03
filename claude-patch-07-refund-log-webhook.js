#!/usr/bin/env node
/* ============================================================================
 * claude-patch-07-refund-log-webhook.js
 * ----------------------------------------------------------------------------
 * Records EVERY refund into the refund_log table (permanent ledger).
 *
 * WHY: refunds are only recorded on the orders row today, so (a) refunds on
 * DELETED accounts vanish with the row, and (b) MANUAL refunds you do in the
 * Stripe Dashboard are never recorded in your app at all.
 *
 * FIX: handle Stripe's "charge.refunded" event in api/stripe-webhook.js. That
 * event fires for every refund - automatic (issued by our code) AND manual
 * (Dashboard). Each is written into refund_log, de-duplicated by the Stripe
 * refund id, and enriched with the user's email/name/plan when still available.
 * refund_log has no foreign key to users, so it survives account deletion.
 *
 * REQUIRES: the refund_log table (separate SQL, run in Supabase first), and
 * the "charge.refunded" event enabled on your Stripe webhook endpoint (see the
 * note printed after this patch runs).
 *
 * SCOPE: api/stripe-webhook.js only. Serverless -> git push redeploys. No cap
 * sync, no rebuild, no ?v bump, no root mirror.
 *
 * SAFE / IDEMPOTENT: backup, UTF-8 no-BOM, skips if already patched
 * (TMC_PATCH_REFUND_LOG), both anchors must match exactly once, node --check
 * with restore-on-failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join('api', 'stripe-webhook.js');
const MARKER = 'TMC_PATCH_REFUND_LOG';

const NEW_CASE = [
  '',
  '      // TMC_PATCH_REFUND_LOG: record every refund (automatic OR manual-in-Stripe)',
  '      case "charge.refunded": {',
  '        await logRefundFromCharge(event.data.object);',
  '        break;',
  '      }'
].join('\n');

const HELPER = [
  '// TMC_PATCH_REFUND_LOG: write every refund into refund_log (survives account',
  '// deletion; also captures manual Dashboard refunds). Best-effort, never throws.',
  'async function logRefundFromCharge(charge) {',
  '  try {',
  '    if (!charge) return;',
  '    const refund = (charge.refunds && charge.refunds.data && charge.refunds.data[0]) || null;',
  '    const refundId = refund ? refund.id : null;',
  '    if (refundId) {',
  '      const { data: existing } = await supabase.from(\'refund_log\').select(\'id\').eq(\'stripe_refund_id\', refundId).maybeSingle();',
  '      if (existing) return; // already logged (dedupe)',
  '    }',
  '    const md = (refund && refund.metadata) || {};',
  '    let source = \'manual_stripe\';',
  '    if (md.path === \'delete_account\') source = \'auto_delete\';',
  '    else if (md.policy === \'14_day_annual_refund\') source = \'auto_cancel\';',
  '    let u = null;',
  '    if (md.user_id) {',
  '      const r = await supabase.from(\'users\').select(\'id,email,name,plan\').eq(\'id\', md.user_id).maybeSingle();',
  '      u = r.data || null;',
  '    }',
  '    if (!u && charge.customer) {',
  '      const r = await supabase.from(\'users\').select(\'id,email,name,plan\').eq(\'stripe_customer_id\', charge.customer).maybeSingle();',
  '      u = r.data || null;',
  '    }',
  '    await supabase.from(\'refund_log\').insert({',
  '      source,',
  '      status: (refund && refund.status) || (charge.refunded ? \'succeeded\' : \'unknown\'),',
  '      amount_cents: refund ? refund.amount : charge.amount_refunded,',
  '      currency: (refund && refund.currency) || charge.currency || \'usd\',',
  '      user_id: (u && u.id) || md.user_id || null,',
  '      user_email: u ? u.email : null,',
  '      user_name: u ? u.name : null,',
  '      plan: u ? u.plan : null,',
  '      stripe_refund_id: refundId,',
  '      stripe_charge_id: charge.id || null,',
  '      stripe_payment_intent: charge.payment_intent || null,',
  '      stripe_customer_id: charge.customer || null,',
  '      error_message: null,',
  '      raw: refund || { charge_id: charge.id, amount_refunded: charge.amount_refunded }',
  '    });',
  '    console.log(\'refund_log: recorded \' + (refundId || charge.id) + \' source=\' + source);',
  '  } catch (e) {',
  '    console.warn(\'refund_log insert failed (non-fatal):\', e && e.message);',
  '  }',
  '}',
  ''
].join('\n');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-07-refund-log-webhook.js');
console.log('-------------------------------------');

if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found (nothing changed).'); process.exit(1); }
const original = fs.readFileSync(FILE, 'utf8');
if (original.indexOf(MARKER) !== -1) { console.log(FILE + ': already patched (skip).'); process.exit(0); }

// Anchor 1: the switch's default case -> insert the new case before it
const A1 = /\n([ \t]*)default:[ \t]*\r?\n[ \t]*break;/;
// Anchor 2: the module.exports line -> insert the helper before it
const A2 = /module\.exports = handler;/;

const c1 = (original.match(new RegExp(A1, 'g')) || []).length;
const c2 = (original.match(new RegExp(A2, 'g')) || []).length;
if (c1 !== 1) { console.log('ABORT - switch default anchor matched ' + c1 + ' (expected 1). Nothing changed.'); process.exit(1); }
if (c2 !== 1) { console.log('ABORT - module.exports anchor matched ' + c2 + ' (expected 1). Nothing changed.'); process.exit(1); }

const backup = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, backup);
try {
  let updated = original.replace(A1, function (m) { return '\n' + NEW_CASE + '\n' + m.replace(/^\n/, ''); });
  updated = updated.replace(A2, function (m) { return HELPER + '\n' + m; });

  if (updated.indexOf(MARKER) === -1 || !/logRefundFromCharge/.test(updated)) throw new Error('post-edit sanity check failed');

  fs.writeFileSync(FILE, Buffer.from(updated, 'utf8'));
  try { execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' }); }
  catch (e) { fs.copyFileSync(backup, FILE); console.log(FILE + ': FAILED node --check -> restored.'); console.log('   ' + String(e.message || e)); process.exit(1); }

  console.log(FILE + ': charge.refunded handler + refund_log logger added.  (backup: ' + path.basename(backup) + ')');
  console.log('-------------------------------------');
  console.log('Done. git add/commit/push -> Vercel redeploys.');
  process.exit(0);
} catch (err) {
  fs.copyFileSync(backup, FILE);
  console.log(FILE + ': FAILED -> restored  (' + String(err.message || err) + ')');
  process.exit(1);
}
