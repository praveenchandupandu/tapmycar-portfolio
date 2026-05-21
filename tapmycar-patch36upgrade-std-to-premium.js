// ============================================================================
// TapMyCar - Patch 36-upgrade: Standard -> Premium upgrade flow
//
// Lets a Standard user upgrade to Premium. They already have 1 sticker;
// Premium needs 3, so 2 more ship to them.
//
// Pricing (confirmed with user):
//   - 2 extra stickers: flat $19.99 (1999 cents)
//   - Annual difference:
//       * PAYING Standard user (has a real subscription with time left):
//         PRORATED difference. Premium annual - Standard annual = $10/yr.
//         prorated = 1000 cents * (daysLeft / 365). Floored at 100 cents
//         so Stripe accepts it. If no subscription / no period end is
//         found -> fall back to a flat 999 cents.
//       * GIFT Standard user (free trial, no paid subscription):
//         full Premium annual $19.99 (1999 cents).
//   Totals: paying ~ $19.99 + prorated ; gift = $19.99 + $19.99 = $39.98
//
//  PART A - api/create-checkout.js:
//     new flow === 'upgrade'. Builds the sticker line + the annual line
//     (prorated or full). Collects shipping. Metadata flow:'upgrade',
//     plan forced to 'premium'.
//
//  PART B - api/stripe-webhook.js:
//     new early branch for flow === 'upgrade'. Sets plan -> premium,
//     creates the Premium subscription, records the order with shipping.
//     The webhook's EXISTING premium-codes block (keys off plan==='premium')
//     then generates the 3 family codes automatically - no new code needed.
//     If the user had an old Standard subscription, it is cancelled.
//
//  PART C - public/manage.html:
//     the "Get Premium" button (currently -> /pricing.html) now starts the
//     upgrade checkout (flow:'upgrade').
//
// Idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch36upgrade-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 36-upgrade \u2014 Standard to Premium upgrade flow');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36UPGRADE_STD_TO_PREMIUM';

// =============================================================================
// PART A - api/create-checkout.js
// =============================================================================

log('Part A  api/create-checkout.js: upgrade flow + proration');
{
  const file = path.join(API, 'create-checkout.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('create-checkout.js');
  } else {
    backup(file);
    let updated = content;

    /* A1: allow 'upgrade' past the flow whitelist guard */
    const oldGuard1 = `  if (flow !== 'activate' && flow !== 'direct' && flow !== 'renew') {`;
    const oldGuard2 = `  if (flow !== 'activate' && flow !== 'direct') {`;
    if (updated.includes(oldGuard1) || updated.includes(oldGuard1.replace(/\n/g,'\r\n'))) {
      updated = safeReplace(updated, oldGuard1,
        `  /* ${MARKER}: allow upgrade flow */\n  if (flow !== 'activate' && flow !== 'direct' && flow !== 'renew' && flow !== 'upgrade') {`);
    } else if (updated.includes(oldGuard2) || updated.includes(oldGuard2.replace(/\n/g,'\r\n'))) {
      updated = safeReplace(updated, oldGuard2,
        `  /* ${MARKER}: allow upgrade flow */\n  if (flow !== 'activate' && flow !== 'direct' && flow !== 'upgrade') {`);
    } else {
      errExit('create-checkout.js: flow whitelist guard not found');
    }
    ok('upgrade flow allowed past whitelist');

    /* A2: insert the upgrade flow block before the 'renew' or 'direct' block */
    const anchorRenew = `    if (flow === 'renew') {`;
    const anchorDirect = `    if (flow === 'direct') {`;
    const upgradeBlock = `    /* ${MARKER}: Standard -> Premium upgrade. 2 extra stickers ($19.99)
       + annual difference (prorated for paying users, full for gift users). */
    if (flow === 'upgrade') {
      /* 2 additional stickers \u2014 flat $19.99 */
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: '2 additional TapMyCar stickers (Premium upgrade)',
            description: 'Two extra weatherproof NFC + QR stickers for your family. Ships in 2-3 business days.'
          },
          unit_amount: 1999
        },
        quantity: 1
      }));
      chargeTodayCents += 1999;

      /* annual difference */
      let annualDiffCents = 1999; /* default: full Premium annual (gift users) */
      let annualLabel = 'Premium annual plan';
      let annualDesc = 'Your Premium plan for one year. Cancel anytime.';

      const hadSub = user.subscription_id && String(user.plan || '').toLowerCase() === 'standard';
      if (hadSub) {
        /* PAYING Standard user \u2014 prorate the $10/yr difference. */
        try {
          const sub = await stripe.subscriptions.retrieve(user.subscription_id);
          const periodEnd = sub && sub.current_period_end ? sub.current_period_end * 1000 : 0;
          if (periodEnd > Date.now()) {
            const daysLeft = Math.ceil((periodEnd - Date.now()) / 86400000);
            const clampedDays = Math.max(0, Math.min(365, daysLeft));
            let prorated = Math.round(1000 * (clampedDays / 365));
            if (prorated < 100) prorated = 100; /* Stripe minimum */
            annualDiffCents = prorated;
            annualLabel = 'Premium upgrade (prorated, ' + clampedDays + ' days remaining)';
            annualDesc = 'Prorated difference to upgrade your remaining Standard term to Premium.';
          } else {
            annualDiffCents = 999; /* fallback flat difference */
            annualLabel = 'Premium upgrade (annual difference)';
          }
        } catch (subErr) {
          console.error('${MARKER}: subscription retrieve failed, flat fallback:', subErr && subErr.message);
          annualDiffCents = 999;
          annualLabel = 'Premium upgrade (annual difference)';
        }
      }

      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: { name: annualLabel, description: annualDesc },
          unit_amount: annualDiffCents
        },
        quantity: 1
      }));
      chargeTodayCents += annualDiffCents;
    }

`;

    if (updated.includes(anchorRenew) || updated.includes(anchorRenew.replace(/\n/g,'\r\n'))) {
      updated = safeReplace(updated, anchorRenew, upgradeBlock + anchorRenew);
    } else if (updated.includes(anchorDirect) || updated.includes(anchorDirect.replace(/\n/g,'\r\n'))) {
      updated = safeReplace(updated, anchorDirect, upgradeBlock + anchorDirect);
    } else {
      errExit('create-checkout.js: renew/direct anchor not found for upgrade block');
    }
    ok('upgrade flow block inserted (sticker line + prorated annual line)');

    writeFile(file, updated);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('create-checkout.js JS valid');
    } catch (e) {
      errExit('create-checkout.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART B - api/stripe-webhook.js
// =============================================================================

log('');
log('Part B  api/stripe-webhook.js: upgrade branch');
{
  const file = path.join(API, 'stripe-webhook.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('stripe-webhook.js');
  } else {
    backup(file);

    /* Anchor: the renew branch we added in 35d-renew ends with "break; }".
       We insert the upgrade branch right before the renew branch's comment.
       Use the renew branch opening as the anchor. */
    const anchor = `        /* TMC_PATCH35DRENEW_GIFT_RENEWAL: renewal flow \u2014 gift trial renewal. The customer paid the
           annual fee today; create the recurring subscription (no trial),
           restore their plan, and reactivate the gift tag they already have. */
        if (flow === 'renew') {`;

    const upgradeBranch = `        /* ${MARKER}: Standard -> Premium upgrade. Customer paid stickers +
           annual difference today. Set plan premium, create the Premium
           subscription, cancel any old Standard sub. The existing
           premium-codes block (keys off plan==='premium') generates the 3
           family codes automatically further down. */
        if (flow === 'upgrade') {
          /* cancel the old Standard subscription if there is one */
          try {
            const { data: uRow } = await supabase
              .from('users').select('subscription_id').eq('id', user_id).single();
            if (uRow && uRow.subscription_id) {
              await stripe.subscriptions.cancel(uRow.subscription_id);
              console.log('\u2713 upgrade: cancelled old Standard sub ' + uRow.subscription_id);
            }
          } catch (cancErr) {
            console.error('upgrade: old sub cancel failed (non-fatal):', cancErr.message);
          }

          /* create the new Premium subscription */
          let upgSub = null;
          try {
            upgSub = await stripe.subscriptions.create({
              customer: session.customer,
              items: [{ price: subscription_price_id }],
              trial_period_days: 365,
              metadata: { user_id, plan: 'premium', flow: 'upgrade' }
            });
            console.log('\u2713 upgrade: Premium subscription ' + upgSub.id);
          } catch (subErr) {
            console.error('upgrade: subscription create failed:', subErr.message);
          }

          /* set the user to premium */
          await supabase
            .from('users')
            .update({
              plan: 'premium',
              subscription_id: upgSub ? upgSub.id : null,
              gift_expired_at: null
            })
            .eq('id', user_id);

          /* mark the user's tag(s) premium + active (in case it was an
             expired gift tag being upgraded) */
          await supabase
            .from('tags')
            .update({ plan: 'premium', status: 'active', gift_expired: false })
            .eq('owner_id', user_id);

          /* record the order WITH shipping so the 2 stickers are fulfilled */
          const upgShip = session.shipping_details || session.collected_information?.shipping_details || null;
          const { data: upgOrder } = await supabase.from('orders').insert({
            user_id,
            plan: 'premium',
            amount: session.amount_total,
            stripe_id: session.id,
            subscription_id: upgSub ? upgSub.id : null,
            status: 'paid',
            sticker_count: 2,
            order_status: 'upgrade',
            shipping_name: upgShip ? upgShip.name : null,
            shipping_address: upgShip ? JSON.stringify(upgShip.address) : null
          }).select().single();

          /* generate the 3 Premium family codes (same as a Premium buy) */
          if (upgOrder) {
            let upgCodes = [];
            for (let i = 0; i < 3; i++) {
              let code = generatePremiumCode();
              for (let a = 0; a < 5; a++) {
                const { data: ex } = await supabase.from('premium_codes').select('id').eq('code', code).maybeSingle();
                if (!ex) break;
                code = generatePremiumCode();
              }
              const { data: cr } = await supabase.from('premium_codes').insert({
                code, buyer_user_id: user_id, buyer_order_id: upgOrder.id
              }).select().single();
              if (cr) upgCodes.push(cr.code);
            }
            if (upgCodes.length > 0) {
              await supabase.from('premium_codes')
                .update({ redeemed_by_user_id: user_id, redeemed_at: new Date().toISOString() })
                .eq('code', upgCodes[0]);
              await supabase.from('users').update({ redeemed_code: upgCodes[0] }).eq('id', user_id);
            }
            console.log('\u2713 upgrade: generated ' + upgCodes.length + ' Premium codes');
          }

          console.log('\u2713 upgrade complete for ' + user_id);
          break;
        }

        /* TMC_PATCH35DRENEW_GIFT_RENEWAL: renewal flow \u2014 gift trial renewal. The customer paid the
           annual fee today; create the recurring subscription (no trial),
           restore their plan, and reactivate the gift tag they already have. */
        if (flow === 'renew') {`;

    const r = safeReplace(content, anchor, upgradeBranch);
    if (!r) errExit('stripe-webhook.js: renew-branch anchor not found (is Patch 35d-renew applied?)');
    writeFile(file, r);

    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('stripe-webhook.js: upgrade branch added, JS valid');
    } catch (e) {
      errExit('stripe-webhook.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART C - public/manage.html
// =============================================================================

log('');
log('Part C  public/manage.html: Get Premium button starts upgrade checkout');
{
  const file = path.join(PUBLIC, 'manage.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('manage.html');
  } else {
    backup(file);

    const oldBtn = `    <button class="btn" id="btn-premium" style="margin-top:12px;font-size:13px;padding:12px 0;background:#1A1A1A" onclick="window.location.href='/pricing.html'">Get Premium</button>`;
    const newBtn = `    <button class="btn" id="btn-premium" style="margin-top:12px;font-size:13px;padding:12px 0;background:#1A1A1A" onclick="p36StartUpgrade()">Upgrade to Premium</button>`;

    let r = safeReplace(content, oldBtn, newBtn);
    if (!r) errExit('manage.html: Get Premium button anchor not found');
    let updated = r;

    /* add the p36StartUpgrade function before the loadManage() call */
    const fnAnchor = `loadManage();`;
    const fnBlock = `/* ${MARKER}: start the Standard -> Premium upgrade checkout. */
async function p36StartUpgrade() {
  var btn = document.getElementById('btn-premium');
  var token = (typeof s !== 'undefined' && s && s.token) ? s.token : (localStorage.getItem('tmc_token') || '');
  if (!token) { window.location.href = '/signin.html'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    var res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: token, flow: 'upgrade', plan: 'premium' })
    });
    var data = await res.json();
    if (data && data.url) { window.location.href = data.url; return; }
    if (btn) { btn.disabled = false; btn.textContent = 'Upgrade to Premium'; }
    alert((data && data.error) || 'Could not start the upgrade. Please try again.');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Upgrade to Premium'; }
    alert('Network error. Please try again.');
  }
}

loadManage();`;

    r = safeReplace(updated, fnAnchor, fnBlock);
    if (!r) errExit('manage.html: loadManage() anchor not found');
    updated = r;

    writeFile(file, updated);
    ok('manage.html: Get Premium button now starts the upgrade checkout');
  }
}

log('');
log('==============================================================');
log('Patch 36-upgrade complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 36-upgrade: Standard to Premium upgrade flow"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('==== TEST IN STRIPE TEST MODE \u2014 this touches real payments ====');
log('Your site is on LIVE keys (sk_live). To test safely WITHOUT a real');
log('charge, verify only up to the Stripe page:');
log('');
log('  1. Sign in as a Standard user (gift-standard or paying-standard).');
log('  2. Open the Manage page.');
log('  3. Under "Available Plans" the Premium card has an "Upgrade to');
log('     Premium" button \u2014 click it.');
log('  4. Stripe Checkout opens. STOP HERE. Do not pay. Confirm:');
log('       - line 1: "2 additional TapMyCar stickers" \u2014 $19.99');
log('       - line 2: "Premium upgrade ..." \u2014 prorated amount for a');
log('         paying user, or $19.99 for a gift-standard user');
log('       - a shipping address form IS shown (2 stickers ship)');
log('  5. Screenshot it and close the tab.');
log('');
log('  Full payment test: do ONE real charge, verify the user becomes');
log('  premium with 3 codes + an upgrade order, then refund in Stripe.');
log('  Verify SQL:');
log('     SELECT plan, subscription_id FROM users WHERE id=(user id);');
log('       -> plan=premium');
log('     SELECT code FROM premium_codes WHERE buyer_user_id=(user id);');
log('       -> 3 rows');
log('     SELECT order_status, sticker_count, shipping_name FROM orders');
log('       WHERE user_id=(user id) ORDER BY id DESC LIMIT 1;');
log('       -> order_status=upgrade, sticker_count=2, shipping filled');
log('==============================================================');
