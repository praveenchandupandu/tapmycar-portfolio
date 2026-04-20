const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * TapMyCar Checkout — v3.0 FINAL
 * ══════════════════════════════════════════════════════════════
 * Implements the authoritative pricing spec with all three flows:
 *
 *   etag_free            — Free eTag download (no Stripe)
 *   activate             — $1 activation; sticker+plan at day 30; annual at day 60
 *   direct + standard    — $9.99 sticker now; annual $9.99 at day 30
 *   direct + premium     — $24.99 (3 stickers) now; annual $19.99 at day 30
 *   +prepay              — bundles year 1 into today's charge for any paid flow
 *
 * Stripe architecture:
 *   - Sticker fees → ONE-TIME payment (mode: payment) or line_item
 *   - Annual fees → RECURRING subscription with trial_period_days
 *   - For `activate` flow, sticker at day 30 is charged via `add_invoice_items`
 *     on the subscription's first invoice at trial-end
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_STANDARD_PRICE_ID    ($9.99/yr recurring Price)
 *   STRIPE_PREMIUM_PRICE_ID     ($19.99/yr recurring Price)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

// ─── CONSTANTS (cents) ──────────────────────────────────────────
const ACTIVATION_FEE = 100;
const STICKER_PRICE = { standard: 999, premium: 2499 };
const ANNUAL_PRICE = { standard: 999, premium: 1999 };

// ─── HANDLER ────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, flow, plan, prepay, referral_discount } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!flow) return res.status(400).json({ error: "flow required: 'etag_free', 'activate', or 'direct'" });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // ─── FLOW 1: Free eTag (no Stripe) ────────────────────────────
  if (flow === 'etag_free') {
    const { data: tag } = await supabase.from('tags').select('*').eq('owner_id', user_id).eq('status', 'unclaimed').single();
    if (tag) {
      await supabase.from('tags').update({ status: 'claimed', plan: 'etag' }).eq('id', tag.id);
    }
    return res.json({ success: true, redirect: '/etag.html', free: true });
  }

  if (flow !== 'activate' && flow !== 'direct') {
    return res.status(400).json({ error: `Invalid flow '${flow}'` });
  }
  if (plan !== 'standard' && plan !== 'premium') {
    return res.status(400).json({ error: `Invalid plan '${plan}'` });
  }

  const STICKER = STICKER_PRICE[plan];
  const ANNUAL = ANNUAL_PRICE[plan];
  const SUB_PRICE_ID = plan === 'standard' ? process.env.STRIPE_STANDARD_PRICE_ID : process.env.STRIPE_PREMIUM_PRICE_ID;

  if (!SUB_PRICE_ID) {
    return res.status(500).json({ error: `Missing STRIPE_${plan.toUpperCase()}_PRICE_ID env var` });
  }

  try {
    // Get/create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: user.name || undefined,
        metadata: { user_id }
      });
      customerId = customer.id;
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user_id);
    }

    // ─── Build line items and trial timeline based on flow+plan+prepay ──
    const lineItems = [];
    let chargeTodayCents = 0;
    let trialDays;  // days until first recurring subscription charge

    if (flow === 'direct') {
      // DIRECT: Pay sticker today. Plan active from day 0. Annual first charge day 30 (or day 365 if prepay)
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard — 1 physical NFC+QR sticker (lifetime)'
              : 'TapMyCar Premium — 3 physical NFC+QR stickers (lifetime)'
          },
          unit_amount: STICKER
        },
        quantity: 1
      });
      chargeTodayCents += STICKER;

      if (prepay) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription` },
            unit_amount: ANNUAL
          },
          quantity: 1
        });
        chargeTodayCents += ANNUAL;
        trialDays = 365;  // no charge until day 365
      } else {
        trialDays = 30;  // first annual charge on day 30
      }
    }

    if (flow === 'activate') {
      // ACTIVATE: $1 today. User still on Free plan until day 30.
      //           Sticker charged at day 30 via subscription invoice.
      //           First real annual charge at day 60.
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'TapMyCar tag activation — $1 lets you try the product for 30 days' },
          unit_amount: ACTIVATION_FEE
        },
        quantity: 1
      });
      chargeTodayCents += ACTIVATION_FEE;

      if (prepay) {
        // Bundle sticker + year 1 annual into today's charge. Subscription starts day 365+30=395 after today.
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan === 'standard' ? 'Standard physical sticker (lifetime)' : 'Premium 3 physical stickers (lifetime)'
            },
            unit_amount: STICKER
          },
          quantity: 1
        });
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription` },
            unit_amount: ANNUAL
          },
          quantity: 1
        });
        chargeTodayCents += STICKER + ANNUAL;
        trialDays = 395;  // 30 days free + 365 days year 1 already paid
      } else {
        // Only $1 today. Sticker will be billed at day 30 on the subscription's first invoice.
        trialDays = 30;  // 30-day trial; at trial-end, sticker fee hits via add_invoice_items
      }
    }

    // Referral discount (applies to first line item only)
    if (referral_discount && referral_discount > 0 && lineItems.length > 0 && lineItems[0].price_data) {
      const discount = Math.min(Math.round(referral_discount * 100), lineItems[0].price_data.unit_amount - 1);
      if (discount > 0) {
        lineItems[0].price_data.unit_amount -= discount;
        chargeTodayCents -= discount;
      }
    }

    // Add the recurring subscription price
    lineItems.push({ price: SUB_PRICE_ID, quantity: 1 });

    // Subscription data — for activate flow without prepay, sticker is added to the first invoice
    const subscriptionData = {
      trial_period_days: trialDays,
      metadata: { user_id, plan, flow, prepay: prepay ? 'true' : 'false' }
    };

    // For activate+no-prepay: add sticker fee to the trial-end invoice (day 30)
    // This creates the Day-30 charge that upgrades them to the plan
    if (flow === 'activate' && !prepay) {
      // Create a one-time product/price for the sticker, attach to first invoice
      const stickerProduct = await getOrCreateProduct(`tapmycar_${plan}_sticker`, plan === 'standard' ? 'Standard sticker' : 'Premium 3 stickers');
      subscriptionData.add_invoice_items = [{
        price_data: {
          currency: 'usd',
          product: stickerProduct,
          unit_amount: STICKER,
          tax_behavior: 'unspecified'
        },
        quantity: 1
      }];
    }

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      subscription_data: subscriptionData,
      shipping_address_collection: { allowed_countries: ['US'] },
      metadata: {
        user_id,
        plan,
        flow,
        prepay: prepay ? 'true' : 'false',
        charge_today_cents: String(chargeTodayCents),
        sticker_count: plan === 'premium' ? '3' : '1',
        referral_discount: String(referral_discount || 0)
      },
      success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}${prepay ? '&prepay=1' : ''}`,
      cancel_url: `${req.headers.origin}/pricing.html`
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url, charge_today_cents: chargeTodayCents });

  } catch (err) {
    console.error('create-checkout error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─── HELPER: find or create a Stripe Product (needed for add_invoice_items) ─
async function getOrCreateProduct(lookupKey, name) {
  try {
    const existing = await stripe.products.search({ query: `metadata['lookup_key']:'${lookupKey}'`, limit: 1 });
    if (existing.data.length > 0) return existing.data[0].id;
  } catch (e) { /* fall through */ }
  const product = await stripe.products.create({ name, metadata: { lookup_key: lookupKey } });
  return product.id;
}
