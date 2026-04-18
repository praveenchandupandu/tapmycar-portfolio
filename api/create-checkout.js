const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * TapMyCar Checkout — v2 pricing model
 * ─────────────────────────────────────
 * Supports 6 purchase flows:
 *
 *   1. ETAG_FREE           — no payment, just register the user's free digital eTag (no Stripe at all)
 *   2. ACTIVATE_STD        — from Free eTag path: $1 activation + Standard ($9.99 sticker at day 30, $9.99/yr from day 30+365)
 *   3. ACTIVATE_STD_PREPAY — $1 + $9.99 sticker + $9.99 year 1 all today, $9.99/yr from day 365
 *   4. ACTIVATE_PREM       — $1 activation + Premium ($24.99 sticker at day 30, $19.99/yr from day 30+365)
 *   5. ACTIVATE_PREM_PREPAY — $1 + $24.99 + $19.99 all today, $19.99/yr from day 365
 *   6. DIRECT_STD          — $9.99 sticker today, $9.99/yr with 30-day trial (first charge day 30)
 *   7. DIRECT_STD_PREPAY   — $9.99 + $9.99 today, $9.99/yr from day 365
 *   8. DIRECT_PREM         — $24.99 sticker today, $19.99/yr with 30-day trial (first charge day 30)
 *   9. DIRECT_PREM_PREPAY  — $24.99 + $19.99 today, $19.99/yr from day 365
 *
 * All paid flows collect a US shipping address and save the card for future charges.
 * Referral discount is applied only on activation fees and sticker fees, not on recurring subscriptions.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY            (sk_test_... for testing, sk_live_... for prod)
 *   STRIPE_STANDARD_PRICE_ID     (Stripe Price for $9.99/yr Standard annual subscription)
 *   STRIPE_PREMIUM_PRICE_ID      (Stripe Price for $19.99/yr Premium annual subscription)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

// ────────────────────────────────────────────────────────────
// CONSTANTS (all prices in cents)
// ────────────────────────────────────────────────────────────
const ACTIVATION_FEE = 100;        // $1.00
const STANDARD_STICKER = 999;      // $9.99
const STANDARD_YEARLY = 999;       // $9.99/yr
const PREMIUM_STICKER = 2499;      // $24.99
const PREMIUM_YEARLY = 1999;       // $19.99/yr

const TRIAL_DAYS_NO_PREPAY = 30;   // 30-day gap before first annual charge
const TRIAL_DAYS_PREPAY = 395;     // 30 (activation → sticker) + 365 (year 1 prepaid)

// ────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, flow, plan, prepay, referral_discount } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!flow) return res.status(400).json({ error: 'flow required (etag_free, activate, direct)' });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // ──── FLOW 1: Free eTag — no Stripe, just mark the user's tag as 'claimed' (not yet active) ────
  if (flow === 'etag_free') {
    // Find the user's existing unclaimed tag (assigned at registration) and mark it claimed.
    // 'claimed' = user owns the PDF but hasn't paid activation → stranger scans show "inactive, activate to use".
    const { data: tag } = await supabase.from('tags').select('*').eq('owner_id', user_id).eq('status', 'unclaimed').single();
    if (tag) {
      await supabase.from('tags').update({ status: 'claimed', plan: 'etag' }).eq('id', tag.id);
    }
    return res.json({ success: true, redirect: '/etag.html', free: true });
  }

  // ──── Flows 2–9 need Stripe + a valid plan ────
  if (flow !== 'activate' && flow !== 'direct') {
    return res.status(400).json({ error: `Invalid flow '${flow}'. Use etag_free, activate, or direct.` });
  }
  if (plan !== 'standard' && plan !== 'premium') {
    return res.status(400).json({ error: `Invalid plan '${plan}'. Use standard or premium.` });
  }

  const STICKER = plan === 'standard' ? STANDARD_STICKER : PREMIUM_STICKER;
  const YEARLY = plan === 'standard' ? STANDARD_YEARLY : PREMIUM_YEARLY;
  const SUBSCRIPTION_PRICE_ID = plan === 'standard' ? process.env.STRIPE_STANDARD_PRICE_ID : process.env.STRIPE_PREMIUM_PRICE_ID;

  if (!SUBSCRIPTION_PRICE_ID) {
    return res.status(500).json({
      error: `Missing Stripe price env var for plan '${plan}'. Set STRIPE_${plan.toUpperCase()}_PRICE_ID in Vercel.`
    });
  }

  try {
    // Get or create Stripe customer
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

    // Build the Checkout Session based on flow + plan + prepay
    const lineItems = [];
    const addInvoiceItems = [];
    let trialDays;
    let chargeToday = 0;  // just for display/metadata

    if (flow === 'activate') {
      // Free eTag user paying to activate — $1 now, sticker delayed 30 days
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'TapMyCar activation', description: 'One-time activation fee' },
          unit_amount: ACTIVATION_FEE
        },
        quantity: 1
      });
      chargeToday += ACTIVATION_FEE;

      if (prepay) {
        // Activation + sticker + year 1 all today; annual subscription starts day 365
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `${plan === 'standard' ? 'Standard' : 'Premium'} sticker`, description: 'Physical NFC+QR sticker (ships in 2-3 days)' },
            unit_amount: STICKER
          },
          quantity: 1
        });
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} service`, description: 'Prepaid annual subscription (year 1)' },
            unit_amount: YEARLY
          },
          quantity: 1
        });
        chargeToday += STICKER + YEARLY;
        trialDays = 365;  // first recurring subscription charge at day 365
      } else {
        // Only $1 today, sticker + year-1 billed as invoice at trial end (day 30)
        addInvoiceItems.push({
          price_data: {
            currency: 'usd',
            product: await createOrGetProduct(`sticker_${plan}`, `${plan === 'standard' ? 'Standard' : 'Premium'} sticker`),
            unit_amount: STICKER,
            tax_behavior: 'unspecified'
          },
          quantity: 1
        });
        trialDays = 30;  // first subscription invoice at day 30, will include sticker + yearly
      }
    }

    if (flow === 'direct') {
      // Direct purchase — sticker today, annual plan starts after 30-day trial
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `TapMyCar ${plan === 'standard' ? 'Standard' : 'Premium'} sticker`, description: 'Physical NFC+QR sticker (ships in 2-3 days)' },
          unit_amount: STICKER
        },
        quantity: 1
      });
      chargeToday += STICKER;

      if (prepay) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} service`, description: 'Prepaid annual subscription (year 1)' },
            unit_amount: YEARLY
          },
          quantity: 1
        });
        chargeToday += YEARLY;
        trialDays = TRIAL_DAYS_PREPAY;  // first recurring charge at day 395
      } else {
        trialDays = TRIAL_DAYS_NO_PREPAY;  // first recurring charge at day 30
      }
    }

    // Apply referral discount (only to non-subscription parts — activation fee + sticker)
    let discount = 0;
    if (referral_discount && referral_discount > 0 && lineItems.length > 0) {
      discount = Math.min(Math.round(referral_discount * 100), lineItems[0].price_data.unit_amount - 1);
      if (discount > 0) {
        lineItems[0].price_data.unit_amount -= discount;
        chargeToday -= discount;
      }
    }

    // Build the Checkout Session (subscription mode always, since every paid flow ends in a subscription)
    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      subscription_data: {
        items: [{ price: SUBSCRIPTION_PRICE_ID }],
        trial_period_days: trialDays,
        metadata: { user_id, plan, flow, prepay: prepay ? 'true' : 'false' },
        ...(addInvoiceItems.length > 0 ? { add_invoice_items: addInvoiceItems } : {})
      },
      shipping_address_collection: { allowed_countries: ['US'] },
      metadata: {
        user_id,
        plan,
        flow,
        prepay: prepay ? 'true' : 'false',
        charge_today_cents: String(chargeToday),
        referral_discount: String(referral_discount || 0)
      },
      success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}`,
      cancel_url: `${req.headers.origin}/pricing.html`
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url, charge_today_cents: chargeToday });

  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────
// HELPER: find-or-create a Stripe Product for add_invoice_items
// (add_invoice_items requires a real Product ID, not price_data)
// ────────────────────────────────────────────────────────────
async function createOrGetProduct(lookupKey, name) {
  try {
    const existing = await stripe.products.search({ query: `metadata['lookup_key']:'${lookupKey}'`, limit: 1 });
    if (existing.data.length > 0) return existing.data[0].id;
  } catch (e) { /* search not always available — fall through to create */ }
  const product = await stripe.products.create({
    name,
    metadata: { lookup_key: lookupKey }
  });
  return product.id;
}
