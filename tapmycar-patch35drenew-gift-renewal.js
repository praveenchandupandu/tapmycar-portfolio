// ============================================================================
// TapMyCar - Patch 35d-renew: Gift trial renewal flow
//
// Problem: when a gift trial ends, "Subscribe now" sent the user to
// /pricing.html, which charges the FULL plan price (sticker fee + annual
// service). But a gift recipient already HAS the sticker - they should pay
// only the annual service fee to reactivate the tag they already hold.
//
// This patch adds a dedicated "renew" flow:
//
//  PART A - api/create-checkout.js:
//     new flow === 'renew'. Charges ONLY the annual subscription price
//     (Standard $9.99 / Premium $19.99) as a one-time payment today. No
//     sticker line item, no shipping address. Metadata flow:'renew'.
//
//  PART B - api/stripe-webhook.js:
//     new early branch for flow === 'renew' in checkout.session.completed.
//     On payment: create the recurring subscription (no trial - they paid
//     today), set users.plan back to the paid plan, clear gift_expired_at,
//     and reactivate the user's gift tag(s): status -> active,
//     gift_expired -> false. Records an order row. Then break.
//
//  PART C - public/dashboard.html:
//     the gift-expiry banner "Subscribe now" button now starts the renew
//     checkout (flow:'renew') instead of linking to /pricing.html.
//
// Design (confirmed with user):
//   - charge the annual fee TODAY, subscription renews yearly after
//   - reactivate the SAME gift tag they already have (no new sticker)
//
// Does NOT touch the activate / direct / etag_free flows - normal new
// customers are completely unaffected.
//
// Properties: idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35drenew-${ts}`);

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
log('TapMyCar Patch 35d-renew \u2014 gift trial renewal flow');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35DRENEW_GIFT_RENEWAL';

// =============================================================================
// PART A - api/create-checkout.js: the 'renew' flow
// =============================================================================

log('Part A  api/create-checkout.js: renew flow');
{
  const file = path.join(API, 'create-checkout.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('create-checkout.js');
  } else {
    backup(file);

    /* Insert the renew flow right before the 'direct' flow block. */
    const anchor = `    if (flow === 'direct') {`;
    const renewBlock = `    /* ${MARKER}: renewal flow \u2014 annual fee ONLY, no sticker, no shipping.
       The gift recipient already has the sticker; this just pays for the
       year of service and reactivates their tag. */
    if (flow === 'renew') {
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard \u2014 annual plan (reactivate your tag)'
              : 'TapMyCar Premium \u2014 annual plan (reactivate your tag)',
            description: 'Renews your TapMyCar service for one year and reactivates the tag you already have. Cancel anytime.'
          },
          unit_amount: ANNUAL
        },
        quantity: 1
      }));
      chargeTodayCents += ANNUAL;
    }

    if (flow === 'direct') {`;

    const r = safeReplace(content, anchor, renewBlock);
    if (!r) errExit('create-checkout.js: direct-flow anchor not found');
    let updated = r;

    /* The sessionParams for 'renew' should NOT collect a shipping address
       (nothing is shipped). The shared sessionParams uses
       shipping_address_collection unconditionally. Make it conditional. */
    const oldShip = `      shipping_address_collection: { allowed_countries: ['US'] },
      billing_address_collection: 'required',`;
    const newShip = `      /* ${MARKER}: renew flow ships nothing \u2014 skip shipping address */
      ...(flow === 'renew' ? {} : { shipping_address_collection: { allowed_countries: ['US'] } }),
      billing_address_collection: 'required',`;
    const r2 = safeReplace(updated, oldShip, newShip);
    if (!r2) errExit('create-checkout.js: shipping_address_collection anchor not found');
    updated = r2;

    /* customer_update references shipping: 'auto' - harmless to keep, Stripe
       ignores shipping update when no shipping collected. Leave as is. */

    writeFile(file, updated);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('create-checkout.js: renew flow added, JS valid');
    } catch (e) {
      errExit('create-checkout.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART B - api/stripe-webhook.js: handle flow === 'renew'
// =============================================================================

log('');
log('Part B  api/stripe-webhook.js: renew branch');
{
  const file = path.join(API, 'stripe-webhook.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('stripe-webhook.js');
  } else {
    backup(file);

    /* Insert an early renew branch right after the metadata guard, before
       the activate/direct subscription logic. */
    const anchor = `        // shipping_details is already on the session object, no expand needed
        const ship = session.shipping_details || session.collected_information?.shipping_details || null;
        const nStickers = parseInt(sticker_count || '1', 10);
        const isPrepay = prepay === 'true';`;

    const renewBranch = `        // shipping_details is already on the session object, no expand needed
        const ship = session.shipping_details || session.collected_information?.shipping_details || null;
        const nStickers = parseInt(sticker_count || '1', 10);
        const isPrepay = prepay === 'true';

        /* ${MARKER}: renewal flow \u2014 gift trial renewal. The customer paid the
           annual fee today; create the recurring subscription (no trial),
           restore their plan, and reactivate the gift tag they already have. */
        if (flow === 'renew') {
          let renewSub = null;
          try {
            renewSub = await stripe.subscriptions.create({
              customer: session.customer,
              items: [{ price: subscription_price_id }],
              /* paid today -> first cycle starts a year out, no trial */
              trial_period_days: 365,
              metadata: { user_id, plan, flow: 'renew' }
            });
            console.log('\u2713 renew: subscription ' + renewSub.id + ' for ' + user_id);
          } catch (subErr) {
            console.error('renew: subscription create failed:', subErr.message);
          }

          /* restore the user's plan + clear gift-expiry state */
          await supabase
            .from('users')
            .update({
              plan: plan,
              subscription_id: renewSub ? renewSub.id : null,
              gift_expired_at: null,
              gift_reminders_sent: ''
            })
            .eq('id', user_id);

          /* reactivate the gift tag(s) the user already holds */
          await supabase
            .from('tags')
            .update({ status: 'active', gift_expired: false })
            .eq('owner_id', user_id)
            .eq('is_gift', true);

          /* record the order */
          await supabase.from('orders').insert({
            user_id,
            plan,
            amount: session.amount_total,
            stripe_id: session.id,
            subscription_id: renewSub ? renewSub.id : null,
            status: 'paid',
            sticker_count: 0,
            order_status: 'renewal'
          });

          console.log('\u2713 renew complete for ' + user_id + ' plan=' + plan);
          break;
        }`;

    const r = safeReplace(content, anchor, renewBranch);
    if (!r) errExit('stripe-webhook.js: metadata-guard anchor not found');
    writeFile(file, r);

    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('stripe-webhook.js: renew branch added, JS valid');
    } catch (e) {
      errExit('stripe-webhook.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART C - public/dashboard.html: gift banner button -> renew checkout
// =============================================================================

log('');
log('Part C  public/dashboard.html: gift banner uses renew checkout');
{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('dashboard.html');
  } else {
    backup(file);

    /* Replace the <a href="/pricing.html"> Subscribe button inside the
       gift-expiry banner with a <button> that starts the renew checkout. */
    const oldBtn = `      <a href="/pricing.html" style="display:inline-block;background:#fff;color:#C2410C;font-weight:700;font-size:13px;padding:9px 18px;border-radius:10px;text-decoration:none">Subscribe now</a>`;
    const newBtn = `      <!-- ${MARKER}: renew checkout, not the full pricing page -->
      <button onclick="p35dStartRenew()" id="gift-renew-btn" style="background:#fff;color:#C2410C;font-weight:700;font-size:13px;padding:9px 18px;border-radius:10px;border:0;cursor:pointer">Subscribe now</button>`;

    let r = safeReplace(content, oldBtn, newBtn);
    if (!r) errExit('dashboard.html: gift banner button anchor not found');
    let updated = r;

    /* Add the p35dStartRenew function. Anchor: just before renderFamilyCodes
       is defined, or fall back to before </script>. We use a robust anchor:
       the gift-expiry banner logic comment we added in 35c-2 is reliable. */
    const fnAnchor = `    // TMC_FAMILY_CODES_LOADER
    renderFamilyCodes(_userPlan, data.premiumCodes || []);`;

    const fnAnchorPlus = `    // TMC_FAMILY_CODES_LOADER
    renderFamilyCodes(_userPlan, data.premiumCodes || []);

    /* ${MARKER}: remember the user's plan for the renew button */
    window.__tmcRenewPlan = (_userPlan === 'premium') ? 'premium' : 'standard';`;

    r = safeReplace(updated, fnAnchor, fnAnchorPlus);
    if (!r) errExit('dashboard.html: renderFamilyCodes anchor not found');
    updated = r;

    /* Add the renew-checkout function before the closing </script>. We
       target the last </script> in the file. */
    const lastScript = '</script>';
    const lastIdx = updated.lastIndexOf(lastScript);
    if (lastIdx === -1) errExit('dashboard.html: no </script> found');

    const renewFn = `
/* ${MARKER}: start the renewal checkout (annual fee only). */
async function p35dStartRenew() {
  var btn = document.getElementById('gift-renew-btn');
  var session = (typeof getSession === 'function') ? getSession() : null;
  var token = session && session.token ? session.token : (localStorage.getItem('tmc_token') || '');
  if (!token) { window.location.href = '/signin.html'; return; }
  var plan = window.__tmcRenewPlan || 'standard';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    var res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: token, flow: 'renew', plan: plan })
    });
    var data = await res.json();
    if (data && data.url) {
      window.location.href = data.url;
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe now'; }
    alert((data && data.error) || 'Could not start checkout. Please try again.');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Subscribe now'; }
    alert('Network error. Please try again.');
  }
}
`;

    updated = updated.slice(0, lastIdx) + renewFn + '\n' + updated.slice(lastIdx);
    writeFile(file, updated);
    ok('dashboard.html: gift banner now starts the renew checkout');
  }
}

log('');
log('==============================================================');
log('Patch 35d-renew complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 35d-renew: gift trial renewal flow"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('==== TEST IN STRIPE TEST MODE FIRST ====');
log('This touches real payments. Test with a Stripe TEST key + test card');
log('before any live charge.');
log('');
log('  1. Make a gift user look expired (Supabase):');
log('       UPDATE users SET plan=(etag), gift_expired_at=NOW()');
log('         WHERE id=(gift user id);');
log('       UPDATE tags SET status=(inactive), gift_expired=true');
log('         WHERE owner_id=(gift user id) AND is_gift=true;');
log('       [replace () with single quotes]');
log('  2. Sign in as that user, open the dashboard.');
log('  3. The gift-expiry banner shows. Click "Subscribe now".');
log('  4. Stripe Checkout opens \u2014 confirm it shows ONLY the annual price');
log('     (Standard $9.99 / Premium $19.99), NO sticker fee, NO shipping');
log('     address form.');
log('  5. Pay with test card 4242 4242 4242 4242, any future expiry, any CVC.');
log('  6. After redirect, verify in Supabase:');
log('       SELECT plan, subscription_id, gift_expired_at FROM users');
log('         WHERE id=(gift user id);');
log('         -> plan restored, subscription_id set, gift_expired_at NULL');
log('       SELECT token, status, gift_expired FROM tags');
log('         WHERE owner_id=(gift user id) AND is_gift=true;');
log('         -> status=active, gift_expired=false');
log('  7. Scan the tag \u2014 the contact page should load again.');
log('==============================================================');
