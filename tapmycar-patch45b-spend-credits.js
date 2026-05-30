/* ============================================================================
 * TapMyCar  Patch 45b  spend referral credits at checkout
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45b-spend-credits.js
 *
 * The last piece of the referral system. After this:
 *
 *   - The available credit is server-side enforced (client cannot fake it).
 *   - For 'renew' and 'upgrade' flows where the credit fully covers the
 *     price: skip Stripe entirely, run side-effects inline, mark credits
 *     consumed, return a redirect to /payment-success.html.
 *   - For all other cases (or when credit is partial): apply the credit
 *     as a line-item discount, send to Stripe with a $1 minimum charge,
 *     mark credits consumed when the webhook confirms payment.
 *   - If a refund is issued via cancel-subscription, the corresponding
 *     referral row (which is still in 'pending' status because of the
 *     14-day hold) is flipped to 'revoked'. No claw-back is ever needed
 *     because consumed credits can only come from rows that have already
 *     passed the 14-day window.
 *   - The pricing page shows a banner with the credit balance and a
 *     checkbox to apply (default ON, user can untick to save credit).
 *
 * Why $1 minimum still applies to activate/direct flows: those flows
 * require Stripe to save the card-on-file for the recurring subscription
 * that's created in the webhook. Stripe payment-mode rejects $0 sessions.
 * For renew and upgrade flows there's no NEW card needed (renew creates
 * a sub from the existing customer's card already on file, upgrade only
 * modifies the existing sub), so we can fully skip Stripe there.
 *
 * Four files modified, plus a new server-side helper to keep create-checkout
 * readable.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH45B.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45B';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45b-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CC = path.join('api', 'create-checkout.js');
const WH = path.join('api', 'stripe-webhook.js');
const CS = path.join('api', 'cancel-subscription.js');
const PR = path.join('public', 'pricing.html');

/* ========================================================================
 * EDIT 1  api/create-checkout.js
 *   - Recompute available credit server-side from referrals table.
 *   - If apply=true and credit > 0:
 *       * For 'renew'/'upgrade' with credit >= total: skip Stripe, inline
 *         side-effects, mark consumed, return free redirect.
 *       * Otherwise: apply as line-item discount (existing path), set
 *         metadata for webhook consumption.
 *   - Ignore any client-supplied referral_discount value.
 * ======================================================================*/

/* find: the existing "Apply referral discount" block, replace with the
   server-enforced version that pulls from the referrals table */
const CC_DISCOUNT_FIND = [
  "    // Apply referral discount",
  "    if (referral_discount && referral_discount > 0 && lineItems.length > 0 && lineItems[0].price_data) {",
  "      const discount = Math.min(Math.round(referral_discount * 100), lineItems[0].price_data.unit_amount - 1);",
  "      if (discount > 0) {",
  "        lineItems[0].price_data.unit_amount -= discount;",
  "        chargeTodayCents -= discount;",
  "      }",
  "    }"
].join('\n');

const CC_DISCOUNT_REPLACE = [
  "    /* TMC_PATCH45B: server-side referral credit. The client may pass",
  "       apply_referral_credit:true/false; the *amount* is recomputed here",
  "       from the referrals table  the client cannot inflate it. Credits",
  "       are spent in FIFO order; we collect the row ids so the webhook (or",
  "       the free-flow branch below) can mark them consumed atomically. */",
  "    const applyCredit = req.body.apply_referral_credit !== false; /* default ON */",
  "    let _tmcCreditCents = 0;",
  "    let _tmcCreditRowIds = [];",
  "    if (applyCredit) {",
  "      const nowIso = new Date().toISOString();",
  "      const { data: avRows } = await supabase",
  "        .from('referrals')",
  "        .select('id, credit_amount, status, available_at')",
  "        .eq('referrer_user_id', user_id)",
  "        .in('status', ['pending','available'])",
  "        .order('paid_at', { ascending: true });",
  "      const usable = (avRows || []).filter(r =>",
  "        r.status === 'available' ||",
  "        (r.status === 'pending' && r.available_at && r.available_at <= nowIso)",
  "      );",
  "      for (const r of usable) {",
  "        _tmcCreditCents += Math.round((parseFloat(r.credit_amount) || 0) * 100);",
  "        _tmcCreditRowIds.push(r.id);",
  "      }",
  "    }",
  "",
  "    /* Apply the credit to the first line item (the dominant charge). The",
  "       $1 floor is needed for activate/direct flows so Stripe has a real",
  "       charge to attach the card to; renew/upgrade can go to $0 (handled",
  "       in the free-flow branch below). */",
  "    let _tmcCreditUsedCents = 0;",
  "    if (_tmcCreditCents > 0 && lineItems.length > 0 && lineItems[0].price_data) {",
  "      const firstUnit = lineItems[0].price_data.unit_amount;",
  "      const fullCoverFlows = (flow === 'renew' || flow === 'upgrade');",
  "      const maxApply = fullCoverFlows ? chargeTodayCents : Math.max(0, chargeTodayCents - 100);",
  "      _tmcCreditUsedCents = Math.min(_tmcCreditCents, maxApply);",
  "      if (_tmcCreditUsedCents > 0) {",
  "        /* distribute across line items so each unit_amount stays >= 0 */",
  "        let remaining = _tmcCreditUsedCents;",
  "        for (const li of lineItems) {",
  "          if (remaining <= 0) break;",
  "          if (!li.price_data) continue;",
  "          const take = Math.min(remaining, li.price_data.unit_amount);",
  "          li.price_data.unit_amount -= take;",
  "          remaining -= take;",
  "        }",
  "        chargeTodayCents -= _tmcCreditUsedCents;",
  "      }",
  "    }",
  "",
  "    /* FREE-FLOW BRANCH: credit covers the whole price AND the flow is one",
  "       where we don't need a new card on file (renew/upgrade). Skip Stripe",
  "       entirely, run the side-effects inline, mark credits consumed. */",
  "    if (chargeTodayCents === 0 && (flow === 'renew' || flow === 'upgrade')) {",
  "      try {",
  "        if (flow === 'renew') {",
  "          /* mirror the webhook's 'renew' side-effects: subscription create",
  "             (paid today => trial 365d so first cycle bills a year out),",
  "             user plan restore, reactivate gift tag(s), record order. */",
  "          let renewSub = null;",
  "          try {",
  "            renewSub = await stripe.subscriptions.create({",
  "              customer: customerId,",
  "              items: [{ price: SUB_PRICE_ID }],",
  "              trial_period_days: 365,",
  "              metadata: { user_id, plan, flow: 'renew', referral_credit_applied: String(_tmcCreditUsedCents) }",
  "            });",
  "          } catch (e) {",
  "            console.error('p45b free renew: sub create failed:', e.message);",
  "          }",
  "          await supabase.from('users').update({",
  "            plan,",
  "            subscription_id: renewSub ? renewSub.id : null,",
  "            gift_expired_at: null,",
  "            gift_reminders_sent: ''",
  "          }).eq('id', user_id);",
  "          await supabase.from('tags').update({",
  "            status: 'active',",
  "            gift_expired: false",
  "          }).eq('owner_id', user_id).eq('is_gift', true);",
  "          await supabase.from('orders').insert({",
  "            user_id, plan,",
  "            amount: 0,",
  "            stripe_id: 'credit_only_' + Date.now(),",
  "            subscription_id: renewSub ? renewSub.id : null,",
  "            status: 'paid',",
  "            sticker_count: 0,",
  "            order_status: 'renewal'",
  "          });",
  "        } else if (flow === 'upgrade') {",
  "          /* upgrade STD -> Premium fully covered by credit. Flip plan,",
  "             generate 3 Premium codes, claim the first to the buyer,",
  "             record an order. We don't modify the existing subscription's",
  "             price here  that's a follow-up the user's annual renewal",
  "             will pick up. */",
  "          await supabase.from('users').update({ plan: 'premium' }).eq('id', user_id);",
  "          const generatePremiumCode = function () {",
  "            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';",
  "            let code = 'TMC-PREM-';",
  "            for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];",
  "            return code;",
  "          };",
  "          const { data: orderRow } = await supabase.from('orders').insert({",
  "            user_id, plan: 'premium',",
  "            amount: 0,",
  "            stripe_id: 'credit_only_' + Date.now(),",
  "            subscription_id: user.subscription_id || null,",
  "            status: 'paid',",
  "            sticker_count: 2,",
  "            order_status: 'upgrade'",
  "          }).select().single();",
  "          const premiumCodes = [];",
  "          if (orderRow) {",
  "            for (let i = 0; i < 3; i++) {",
  "              let code = generatePremiumCode();",
  "              for (let a = 0; a < 5; a++) {",
  "                const { data: ex } = await supabase.from('premium_codes').select('id').eq('code', code).maybeSingle();",
  "                if (!ex) break;",
  "                code = generatePremiumCode();",
  "              }",
  "              const { data: cr } = await supabase.from('premium_codes').insert({",
  "                code, buyer_user_id: user_id, buyer_order_id: orderRow.id",
  "              }).select().single();",
  "              if (cr) premiumCodes.push(cr.code);",
  "            }",
  "            if (premiumCodes.length > 0) {",
  "              await supabase.from('premium_codes')",
  "                .update({ redeemed_by_user_id: user_id, redeemed_at: new Date().toISOString() })",
  "                .eq('code', premiumCodes[0]);",
  "              await supabase.from('users').update({ redeemed_code: premiumCodes[0] }).eq('id', user_id);",
  "            }",
  "          }",
  "        }",
  "        /* Mark the consumed credits in the referrals table. */",
  "        if (_tmcCreditRowIds.length > 0) {",
  "          await supabase.from('referrals').update({",
  "            status: 'consumed',",
  "            consumed_at: new Date().toISOString()",
  "          }).in('id', _tmcCreditRowIds);",
  "        }",
  "        return res.json({",
  "          free: true,",
  "          redirect: '/payment-success.html?free=1&plan=' + plan + '&flow=' + flow,",
  "          credit_used_cents: _tmcCreditUsedCents",
  "        });",
  "      } catch (e) {",
  "        console.error('p45b free-flow failed:', e && e.message);",
  "        return res.status(500).json({ error: 'Could not complete the free purchase. Please try again or contact support.' });",
  "      }",
  "    }"
].join('\n');

/* The metadata block on the Stripe session also needs the credit amount + row ids
   so the webhook can mark them consumed. Anchor: the existing metadata block. */
const CC_META_FIND = [
  "        referral_discount: String(referral_discount || 0)",
  "      },"
].join('\n');

const CC_META_REPLACE = [
  "        referral_discount: String(referral_discount || 0),",
  "        /* TMC_PATCH45B: webhook uses these to mark credits consumed after payment. */",
  "        referral_credit_applied: String(_tmcCreditUsedCents || 0),",
  "        referral_credit_row_ids: (_tmcCreditRowIds || []).join(',')",
  "      },"
].join('\n');

/* ========================================================================
 * EDIT 2  api/stripe-webhook.js
 *   On checkout.session.completed, if metadata.referral_credit_applied > 0,
 *   mark those rows consumed. Idempotent (only flips status if 'available'
 *   or 'pending').
 * ======================================================================*/

/* Insert the consumption block just before the existing referral-rewards
   section, which already has a clean anchor we can use. */
const WH_FIND = [
  "        // ─── REFERRAL REWARDS ───────────────────────────────────",
  "        /* TMC_PATCH45A: gate on parent_user_id  Premium-gift-code"
].join('\n');

const WH_REPLACE = [
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
  "        }",
  "",
  "        // ─── REFERRAL REWARDS ───────────────────────────────────",
  "        /* TMC_PATCH45A: gate on parent_user_id  Premium-gift-code"
].join('\n');

/* ========================================================================
 * EDIT 3  api/cancel-subscription.js
 *   When a refund is issued, revoke this user's matching referral row
 *   (status='pending', referred_user_id=this user). Only 'pending' rows;
 *   'available' or 'consumed' should not be reachable because of the 14-day
 *   hold (refund window is 14d, hold is 14d, so by the time the credit's
 *   spendable the refund window has passed). Still: gate on status to be safe.
 * ======================================================================*/

const CS_FIND = [
  "    if (refundIssued) {",
  "      await supabase.from(\"users\")",
  "        .update({ subscription_id: null, plan: 'etag' })",
  "        .eq(\"id\", user.id);",
  "      // tags table — stop the tag immediately",
  "      await supabase.from(\"tags\")",
  "        .update({ status: 'inactive' })",
  "        .eq(\"owner_id\", user.id);",
  "    } else {"
].join('\n');

const CS_REPLACE = [
  "    if (refundIssued) {",
  "      await supabase.from(\"users\")",
  "        .update({ subscription_id: null, plan: 'etag' })",
  "        .eq(\"id\", user.id);",
  "      // tags table — stop the tag immediately",
  "      await supabase.from(\"tags\")",
  "        .update({ status: 'inactive' })",
  "        .eq(\"owner_id\", user.id);",
  "      /* TMC_PATCH45B: revoke this user's matching referral row if still",
  "         in 'pending' (i.e. inside the 14-day hold). The 14-day hold means",
  "         the referrer cannot have spent the credit yet, so no claw-back",
  "         is needed. We only act on 'pending' rows to be defensive. */",
  "      try {",
  "        await supabase.from('referrals').update({",
  "          status: 'revoked',",
  "          revoked_at: new Date().toISOString(),",
  "          revoke_reason: 'referred_user_refunded'",
  "        }).eq('referred_user_id', user.id).eq('status', 'pending');",
  "      } catch (e) {",
  "        console.warn('p45b: referral revoke failed (non-fatal):', e && e.message);",
  "      }",
  "    } else {"
].join('\n');

/* ========================================================================
 * EDIT 4  public/pricing.html
 *   - Top banner: "You have $X.XX in referral credit"  ☑ "Apply at checkout"
 *   - On every "Buy" click: read the checkbox state and pass it through to
 *     create-checkout.js as apply_referral_credit.
 *   - If response is { free:true }, redirect immediately instead of opening
 *     a Stripe URL.
 * ======================================================================*/

/* Find the existing checkout-button JS handler; we'll wrap it.
   Pricing.html is large  to keep matches reliable, we anchor on a known
   pattern. Inspecting the file shows fetch('/api/create-checkout' calls. */
const PR_BANNER_INSERT_FIND = "</head>";
const PR_BANNER_INSERT_REPLACE = [
  "<script>",
  "/* TMC_PATCH45B: pricing-page referral-credit banner + apply checkbox.",
  "   Fetches the user's available credit on load. If > 0, inserts a banner",
  "   above the plan cards with a checkbox (default ON). The checkout button",
  "   handlers read the checkbox state and pass apply_referral_credit through.",
  "   Free-flow responses ({ free:true, redirect }) are handled directly. */",
  "(function () {",
  "  function inject(creditDollars) {",
  "    if (creditDollars <= 0) return;",
  "    var bar = document.createElement('div');",
  "    bar.id = 'tmc-refbar';",
  "    bar.style.cssText = 'background:linear-gradient(90deg,#DCFCE7,#BBF7D0);border:1px solid #86EFAC;border-radius:12px;padding:12px 14px;margin:12px 16px 0;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;gap:10px';",
  "    bar.innerHTML =",
  "      '<div style=\"flex:1\">' +",
  "        '<div style=\"font-size:13px;font-weight:800;color:#166534\">You have $' + creditDollars.toFixed(2) + ' in referral credit</div>' +",
  "        '<label style=\"display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:#15803D;font-weight:600;cursor:pointer\">' +",
  "          '<input type=\"checkbox\" id=\"tmc-apply-credit\" checked style=\"width:14px;height:14px;cursor:pointer\">' +",
  "          'Apply at checkout' +",
  "        '</label>' +",
  "      '</div>';",
  "    var anchor = document.querySelector('main') || document.body.firstElementChild || document.body;",
  "    if (anchor && anchor.firstChild) anchor.insertBefore(bar, anchor.firstChild);",
  "    else document.body.appendChild(bar);",
  "  }",
  "  function load() {",
  "    try {",
  "      var raw = localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token');",
  "      if (!raw) return;",
  "      fetch('/api/get-referral', { headers: { 'Authorization': 'Bearer ' + raw } })",
  "        .then(function (r) { return r.ok ? r.json() : null; })",
  "        .then(function (d) {",
  "          if (!d || !d.success) return;",
  "          var c = (typeof d.credit_available === 'number') ? d.credit_available : 0;",
  "          inject(c);",
  "        })",
  "        .catch(function () {});",
  "    } catch (e) {}",
  "  }",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', load);",
  "  } else { load(); }",
  "",
  "  /* Wrap fetch so any POST to /api/create-checkout automatically carries",
  "     apply_referral_credit based on the checkbox, AND any { free:true,",
  "     redirect } response is honored as a window.location.href redirect",
  "     (the existing handlers expect { url } from Stripe; they wouldn't",
  "     know what to do with free:true otherwise). */",
  "  var origFetch = window.fetch && window.fetch.bind(window);",
  "  if (!origFetch || window.__tmcCheckoutWrapped) return;",
  "  window.__tmcCheckoutWrapped = true;",
  "  window.fetch = function (input, init) {",
  "    try {",
  "      var url = (typeof input === 'string') ? input : (input && input.url) || '';",
  "      if (url && url.indexOf('/api/create-checkout') !== -1 && init && init.method === 'POST') {",
  "        var cb = document.getElementById('tmc-apply-credit');",
  "        var apply = cb ? !!cb.checked : true;",
  "        try {",
  "          var b = init.body ? JSON.parse(init.body) : {};",
  "          if (typeof b.apply_referral_credit === 'undefined') b.apply_referral_credit = apply;",
  "          init = Object.assign({}, init, { body: JSON.stringify(b) });",
  "        } catch (e) { /* if body isn't JSON, leave it alone */ }",
  "        return origFetch(input, init).then(function (resp) {",
  "          /* clone so existing handlers can still read it */",
  "          var cloned = resp.clone();",
  "          cloned.json().then(function (d) {",
  "            if (d && d.free === true && d.redirect) {",
  "              window.location.href = d.redirect;",
  "            }",
  "          }).catch(function () {});",
  "          return resp;",
  "        });",
  "      }",
  "    } catch (e) {}",
  "    return origFetch(input, init);",
  "  };",
  "})();",
  "</script>",
  "</head>"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 45b  spend referral credits at checkout');
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
    { label: 'create-checkout: discount + free-flow', find: CC_DISCOUNT_FIND, replace: CC_DISCOUNT_REPLACE },
    { label: 'create-checkout: metadata for webhook', find: CC_META_FIND,     replace: CC_META_REPLACE     }
  ])) {
    execSync('node --check "' + CC + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(WH, [
    { label: 'stripe-webhook: mark consumed', find: WH_FIND, replace: WH_REPLACE }
  ])) {
    execSync('node --check "' + WH + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(CS, [
    { label: 'cancel-subscription: revoke pending', find: CS_FIND, replace: CS_REPLACE }
  ])) {
    execSync('node --check "' + CS + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(PR, [
    { label: 'pricing.html: banner + fetch wrap', find: PR_BANNER_INSERT_FIND, replace: PR_BANNER_INSERT_REPLACE }
  ])) {
    /* validate the injected <script> block parses */
    const s = fs.readFileSync(PR, 'utf8');
    const i = s.indexOf('TMC_PATCH45B: pricing-page referral-credit banner');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p45b-pr-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p45b-pr-chk.js', { stdio: 'pipe' });
      log('   - pricing.html script: node --check OK');
    }
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
  log('  2. git commit -m "Patch 45b: spend referral credits at checkout"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test (see verification notes below).\n');
  log('TESTING (when you have $X in available credit):');
  log('  - Visit /pricing.html  green banner shows "$X in referral credit"');
  log('    with the checkbox checked.');
  log('  - Untick  click any plan  Stripe checkout shows full price.');
  log('  - Re-tick  click a plan where credit < total  Stripe shows the');
  log('    discounted price. Pay; webhook marks the credits consumed.');
  log('  - Re-tick  click renew or upgrade where credit >= total  no');
  log('    Stripe page, redirect to /payment-success.html?free=1.\n');
}
