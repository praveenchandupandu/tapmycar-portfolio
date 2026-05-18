// ============================================================================
// TapMyCar - Patch 34: Enable Stripe Tax (automatic_tax) at checkout
//
// Background:
//   Praman Tech LLC has a Connecticut sales tax permit effective 2026-06-01.
//   Connecticut sales are subject to 6.35% state sales tax. Currently the
//   checkout charges the displayed price with no tax — out-of-pocket
//   liability for the merchant on every CT sale.
//
//   Decision (per business policy): apply 6.35% standard rate to ALL line
//   items uniformly (stickers + subscriptions + activation fees).
//   Rationale: simplest, safest. May revisit when business has CPA opinion
//   re: 1% computer-and-data-processing rate for SaaS portion.
//
// What this patch does in code:
//   1. Adds `automatic_tax: { enabled: true }` to the checkout session
//   2. Adds `customer_update: { address: 'auto', shipping: 'auto' }` so
//      Stripe can persist the customer's tax address on the Stripe customer
//      record (required when automatic_tax is on with an existing customer)
//   3. Adds `tax_behavior: 'exclusive'` to every price_data so tax adds on
//      top of the displayed price rather than being baked in
//   4. Adds `product_data.tax_code: 'txcd_99999999'` (general tangible goods)
//      to every line item — Stripe Tax requires every product to have a
//      tax code. txcd_99999999 = "General — Tangible Goods" which is the
//      6.35% standard rate in CT.
//   5. Updates pricing.html footer copy to mention "Tax calculated at
//      checkout based on shipping address" so customers aren't surprised
//      by the extra line at Stripe checkout.
//   6. Updates payment-success.html copy.
//
// REQUIRED Stripe Dashboard setup BEFORE deploying this patch:
//   See bottom of script for the full checklist. Short version:
//   - Settings > Tax > Activate Stripe Tax
//   - Add registration: Connecticut, effective 2026-06-01,
//     your CT registration number
//   - Choose preset: "Custom" with all categories at standard rate
//   - Verify your business address (Connecticut) in Settings > Business Details
//
// Until June 1, this code change is safe to deploy IF Stripe Tax is
// "enabled but not active for CT yet" — Stripe will just calculate $0 tax
// on CT sales until June 1 because the registration's effective date
// hasn't been reached.
//
// Properties: idempotent, validates JS, backs up touched files.
// Uses safeReplace (function-callback) to avoid the $' interpolation bug.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
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
function validateJs(p) {
  try { execSync('node --check "' + p + '"', { stdio: 'pipe' }); }
  catch (e) { errExit('JS syntax error in ' + p + '\n' + e.stderr.toString()); }
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
log('TapMyCar Patch 34 \u2014 enable Stripe Tax (automatic_tax) at checkout');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34_AUTOMATIC_TAX';

// ===========================================================================
// 34.1  api/create-checkout.js — add automatic_tax + tax_code on each price
// ===========================================================================

log('34.1  api/create-checkout.js: add automatic_tax + per-item tax_code');
{
  const file = path.join(API, 'create-checkout.js');
  const content = readFile(file);

  if (content.includes(MARKER)) {
    skip('create-checkout.js');
  } else {
    backup(file);
    let updated = content;

    // ── A) Add a helper constant near the top of the function, AND a small
    //       helper that injects tax_code + tax_behavior into a line_items entry.
    //       We hook the helper right at the start of the handler so it's
    //       always defined when used below.

    // Find the start of the handler body to inject the helper.
    const helperAnchor = `module.exports = async function handler(req, res) {`;
    const helperAddition = `module.exports = async function handler(req, res) {
  /* ${MARKER}: per-item tax code. CT 6.35% standard rate on all items
     for now. When CPA confirms a different SaaS rate, change the tax_code
     on subscription/activation line items. */
  const _STRIPE_TAX_CODE = 'txcd_99999999'; // General — Tangible Goods (standard rate)

  function _withTax(item) {
    if (item && item.price_data) {
      item.price_data.tax_behavior = 'exclusive';
      item.price_data.product_data = item.price_data.product_data || {};
      item.price_data.product_data.tax_code = _STRIPE_TAX_CODE;
    }
    return item;
  }
`;

    let r = safeReplace(updated, helperAnchor, helperAddition);
    if (!r) errExit('create-checkout.js: handler anchor not found');
    updated = r;

    // ── B) Wrap every existing lineItems.push(...) call with _withTax(...)
    //       so each item picks up tax_behavior + tax_code.
    //       We find each lineItems.push and replace the literal "lineItems.push("
    //       with "lineItems.push(_withTax(" then add a closing ).
    //
    //       Safer approach: replace specific patterns that we know exist.

    // Pattern 1: 3 occurrences (activate flow sticker, activate flow annual,
    // direct flow sticker, direct flow prepay annual)
    // Each has form: lineItems.push({\n  price_data: {\n  ...\n  quantity: N\n});
    // We'll find each unique '{ ... }, quantity: 1 });' block and wrap it.

    // Simpler: handle each push by anchoring on the surrounding context.

    // Activate flow sticker push
    const a1 = `      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'TapMyCar Activation \u2014 secure your eTag' },
          unit_amount: ACTIVATION_FEE
        },
        quantity: 1
      });`;
    const a1n = `      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: { name: 'TapMyCar Activation \u2014 secure your eTag' },
          unit_amount: ACTIVATION_FEE
        },
        quantity: 1
      }));`;
    if (updated.includes(a1) || updated.includes(a1.replace(/\n/g, '\r\n'))) {
      updated = safeReplace(updated, a1, a1n) || updated;
    }

    // Activate flow prepay STICKER push
    const a2 = `        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Standard sticker (1)\` },
            unit_amount: STICKER
          },
          quantity: 1
        });
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Year 1 \${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription\` },
            unit_amount: ANNUAL
          },
          quantity: 1
        });`;
    const a2n = `        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Standard sticker (1)\` },
            unit_amount: STICKER
          },
          quantity: 1
        }));
        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Year 1 \${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription\` },
            unit_amount: ANNUAL
          },
          quantity: 1
        }));`;
    if (updated.includes(a2) || updated.includes(a2.replace(/\n/g, '\r\n'))) {
      updated = safeReplace(updated, a2, a2n) || updated;
    }

    // Direct flow sticker push
    const d1 = `      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard \u2014 1 physical NFC + QR sticker (lifetime)'
              : 'TapMyCar Premium \u2014 3 physical NFC + QR stickers (lifetime, for family)',
            description: plan === 'standard'
              ? \`Ships in 2-3 business days. On day 30, your $9.99/year annual plan begins. Cancel anytime.\`
              : \`Ships in 2-3 business days. Comes with 3 gift codes to share with family. On day 30, your $19.99/year annual plan begins. Cancel anytime.\`
          },
          unit_amount: STICKER
        },
        quantity: 1
      });`;
    const d1n = `      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard \u2014 1 physical NFC + QR sticker (lifetime)'
              : 'TapMyCar Premium \u2014 3 physical NFC + QR stickers (lifetime, for family)',
            description: plan === 'standard'
              ? \`Ships in 2-3 business days. On day 30, your $9.99/year annual plan begins. Cancel anytime.\`
              : \`Ships in 2-3 business days. Comes with 3 gift codes to share with family. On day 30, your $19.99/year annual plan begins. Cancel anytime.\`
          },
          unit_amount: STICKER
        },
        quantity: 1
      }));`;
    if (updated.includes(d1) || updated.includes(d1.replace(/\n/g, '\r\n'))) {
      updated = safeReplace(updated, d1, d1n) || updated;
    }

    // Direct flow prepay annual push
    const d2 = `        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Year 1 \${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription\` },
            unit_amount: ANNUAL
          },
          quantity: 1
        });
        chargeTodayCents += ANNUAL;`;
    const d2n = `        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: { name: \`Year 1 \${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription\` },
            unit_amount: ANNUAL
          },
          quantity: 1
        }));
        chargeTodayCents += ANNUAL;`;
    if (updated.includes(d2) || updated.includes(d2.replace(/\n/g, '\r\n'))) {
      updated = safeReplace(updated, d2, d2n) || updated;
    }

    // Verify every push was wrapped
    const stillUnWrapped = (updated.match(/lineItems\.push\(\{/g) || []).length;
    if (stillUnWrapped > 0) {
      // Safety sweep: wrap any remaining `lineItems.push({...});` blocks.
      // This handles activate-flow variants whose exact text differs slightly.
      // Strategy: regex-find each lineItems.push({ block, balanced through
      // its closing }); turn into lineItems.push(_withTax({...}));
      const before = updated.length;
      // Track positions of lineItems.push( and step through to find matching close.
      let i = 0;
      let out = '';
      while (i < updated.length) {
        const idx = updated.indexOf('lineItems.push({', i);
        if (idx < 0) { out += updated.slice(i); break; }
        out += updated.slice(i, idx);
        out += 'lineItems.push(_withTax({';
        // Find the matching '});' for the object literal we just opened.
        let depth = 1;
        let j = idx + 'lineItems.push({'.length;
        while (j < updated.length && depth > 0) {
          const c = updated[j];
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              // Expect ');' after this }
              break;
            }
          }
          j++;
        }
        // Capture the body between idx+'lineItems.push({'.length and j (j points to closing })
        const body = updated.slice(idx + 'lineItems.push({'.length, j);
        out += body;
        // After the closing } we expect '\n      });' or similar — replace ');' with '}));'
        // Append the } we matched, plus close the _withTax( and the .push(
        out += '}));';
        // Skip past the original '});' in the source (the } we matched + 2 chars for ');')
        // But be careful: after } there may be whitespace before );
        j++; // past the }
        // Skip whitespace
        while (j < updated.length && /\s/.test(updated[j])) { j++; }
        // Skip the ');'
        if (updated.slice(j, j + 2) === ');') j += 2;
        i = j;
      }
      updated = out;
      const remaining = (updated.match(/lineItems\.push\(\{/g) || []).length;
      if (remaining > 0) {
        warn('create-checkout.js: ' + remaining + ' lineItems.push() still unwrapped after sweep');
      } else {
        ok('Safety sweep wrapped ' + stillUnWrapped + ' remaining lineItems.push calls');
      }
    } else {
      ok('All lineItems.push wrapped with _withTax');
    }

    // ── C) Add automatic_tax + customer_update to sessionParams
    const sessionAnchor = `    const sessionParams = {
      mode: 'payment',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      payment_intent_data: {
        // Save the card to the customer so the webhook can create a subscription later
        setup_future_usage: 'off_session'
      },
      shipping_address_collection: { allowed_countries: ['US'] },`;
    const sessionAddition = `    const sessionParams = {
      mode: 'payment',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      payment_intent_data: {
        // Save the card to the customer so the webhook can create a subscription later
        setup_future_usage: 'off_session'
      },
      shipping_address_collection: { allowed_countries: ['US'] },
      billing_address_collection: 'required',
      /* ${MARKER}: Stripe Tax \u2014 calculates tax based on shipping address */
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', shipping: 'auto', name: 'auto' },`;
    let r2 = safeReplace(updated, sessionAnchor, sessionAddition);
    if (!r2) errExit('create-checkout.js: sessionParams anchor not found');
    updated = r2;

    writeFile(file, updated);
    validateJs(file);
    ok('create-checkout.js: automatic_tax enabled + tax codes injected');
  }
}

// ===========================================================================
// 34.2  public/pricing.html — copy update
// ===========================================================================

log('');
log('34.2  public/pricing.html: tax disclaimer copy');
{
  const file = path.join(PUBLIC, 'pricing.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('pricing.html');
  } else {
    backup(file);
    const anchor = `    Cancel anytime in Settings.<br>
    Annual subscription is refundable within 14 days of each annual charge ($1 service fee retained).<br>
    Activation fees, sticker fees, and prepaid bundle extras are non-refundable.<br>`;
    const replacement = `    <!-- ${MARKER}: tax disclaimer -->
    Cancel anytime in Settings.<br>
    Prices shown do not include sales tax. Tax is calculated at checkout based on your shipping address.<br>
    Annual subscription is refundable within 14 days of each annual charge ($1 service fee retained).<br>
    Activation fees, sticker fees, and prepaid bundle extras are non-refundable.<br>`;
    const r = safeReplace(content, anchor, replacement);
    if (!r) warn('pricing.html: footer anchor not found');
    else {
      writeFile(file, r);
      ok('pricing.html: tax disclaimer added');
    }
  }
}

// ===========================================================================
// 34.3  public/activate.html — copy update
// ===========================================================================

log('');
log('34.3  public/activate.html: tax disclaimer near payment step');
{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('activate.html');
  } else {
    backup(file);
    // Add a small disclaimer line into the activate page near where price is shown.
    // Anchor on the existing refund-policy block from Patch 31.
    const anchor = `<!-- TMC_PATCH31_REFUND: accurate refund policy -->
<div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 to stop the $9.99 annual charge. The $1 activation fee is non-refundable.</div></div>`;
    const replacement = `<!-- TMC_PATCH31_REFUND: accurate refund policy -->
<div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 to stop the $9.99 annual charge. The $1 activation fee is non-refundable.</div></div>
<!-- ${MARKER}: tax notice -->
<div style="font-size:10px;color:#9CA3AF;margin-top:6px;text-align:center">Sales tax calculated at checkout</div>`;
    const r = safeReplace(content, anchor, replacement);
    if (!r) warn('activate.html: refund-policy anchor not found, tax notice not added');
    else {
      writeFile(file, r);
      ok('activate.html: tax notice added near payment step');
    }
  }
}

// ===========================================================================
// 34.4  public/payment-success.html — copy update
// ===========================================================================

log('');
log('34.4  public/payment-success.html: tax mention in summary');
{
  const file = path.join(PUBLIC, 'payment-success.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('payment-success.html');
  } else {
    backup(file);
    // Patch 31 set up a clearer footer; we add tax mention next to it.
    const anchor = `    <!-- TMC_PATCH31_REFUND: clearer footer -->
    Cancel anytime in Settings. Annual subscription refundable within 14 days ($1 service fee retained). Activation and sticker fees are non-refundable.<br>`;
    const replacement = `    <!-- TMC_PATCH31_REFUND: clearer footer -->
    <!-- ${MARKER}: tax mention -->
    Cancel anytime in Settings. Annual subscription refundable within 14 days ($1 service fee retained). Activation and sticker fees are non-refundable. Sales tax (when applicable) was added at checkout.<br>`;
    const r = safeReplace(content, anchor, replacement);
    if (!r) warn('payment-success.html: footer anchor not found');
    else {
      writeFile(file, r);
      ok('payment-success.html: tax mention added');
    }
  }
}

log('');
log('==============================================================');
log('Patch 34 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('STRIPE DASHBOARD SETUP (do this BEFORE deploying)');
log('==============================================================');
log('');
log('1. Stripe Dashboard > Settings > Tax');
log('   - Click "Activate Stripe Tax"');
log('   - It will ask for your business address \u2014 enter Praman Tech LLC,');
log('     Connecticut address');
log('');
log('2. Settings > Tax > Registrations > Add Registration');
log('   - Country: United States');
log('   - State: Connecticut');
log('   - Registration number: your CT sales tax ID (from your permit)');
log('   - Effective date: 2026-06-01 (matching your permit start)');
log('   - Click Save');
log('');
log('3. Settings > Tax > Tax Settings > Default Tax Behavior');
log('   - Set to "Exclusive" (tax added on top of displayed price)');
log('');
log('4. Settings > Tax > Tax Code (default for your products)');
log('   - Leave as is OR set to "txcd_99999999" (General \u2014 Tangible Goods)');
log('     for the standard rate. This matches what the code now sends.');
log('');
log('5. Settings > Business Details');
log('   - Verify your Connecticut address is set as the principal location');
log('');
log('IMPORTANT: until 2026-06-01, Stripe will calculate $0 tax even on');
log('CT sales because the registration is not yet effective. After 2026-06-01,');
log('Stripe will start applying 6.35% to CT customers automatically.');
log('Out-of-state customers always get $0 tax until you have nexus elsewhere.');
log('');
log('==============================================================');
log('DEPLOY (after dashboard setup is complete):');
log('==============================================================');
log('');
log('  git add -A');
log('  git commit -m "Patch 34: enable Stripe automatic_tax at checkout"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('==============================================================');
log('VERIFY (after deploy, in TEST MODE if possible):');
log('==============================================================');
log('');
log('1. Sign in as a CT-address test user, go to pricing, buy Standard.');
log('2. At Stripe checkout page, you should see:');
log('     Subtotal     $9.99');
log('     Tax (CT)     $0.63');
log('     Total       $10.62');
log('   (Will show $0 tax before 2026-06-01 \u2014 thats expected.)');
log('3. Sign in as a CA-address test user, same flow.');
log('   You should see $0 tax \u2014 you have no CA nexus.');
log('4. Pricing page footer should show "Tax calculated at checkout".');
log('');
log('==============================================================');
log('FILING (recurring obligation \u2014 set calendar reminders!):');
log('==============================================================');
log('');
log('- 15th of each month: log into Stripe Tax > Reports.');
log('  Note the "tax collected" for Connecticut for the prior month.');
log('- By the 20th of each month: log into myconneCT portal,');
log('  file your Connecticut sales tax return, pay the amount Stripe shows.');
log('- Even if you collected $0, file a "zero return". Missing a filing');
log('  has penalties even with no tax owed.');
log('==============================================================');
