const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * TapMyCar Checkout — v2.1 (corrected Stripe API)
 * ════════════════════════════════════════════════
 * Fix: the recurring subscription price must be in `line_items`, NOT in
 * `subscription_data.items` (which Stripe doesn't recognize for Checkout Sessions).
 */

const ACTIVATION_FEE_CENTS = 100;
const STICKER_CENTS = { standard: 999, premium: 2499 };
const YEARLY_CENTS = { standard: 999, premium: 1999 };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, flow, plan, prepay, referral_discount } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!flow) return res.status(400).json({ error: "flow required (one of: 'etag_free', 'activate', 'direct')" });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // ─── FLOW 1: Free eTag — no Stripe ─────────────────────────────
  if (flow === 'etag_free') {
    const { data: tag } = await supabase.from('tags').select('*').eq('owner_id', user_id).eq('status', 'unclaimed').single();
    if (tag) {
      await supabase.from('tags').update({ status: 'claimed', plan: 'etag' }).eq('id', tag.id);
    }
    return res.json({ success: true, redirect: '/etag.html', free: true });
  }

  if (flow !== 'activate' && flow !== 'direct') {
    return res.status(400).json({ error: `Invalid flow '${flow}'. Use 'etag_free', 'activate', or 'direct'.` });
  }
  if (plan !== 'standard' && plan !== 'premium') {
    return res.status(400).json({ error: `Invalid plan '${plan}'. Use 'standard' or 'premium'.` });
  }

  const STICKER = STICKER_CENTS[plan];
  const YEARLY = YEARLY_CENTS[plan];
  const SUBSCRIPTION_PRICE_ID = plan === 'standard'
    ? process.env.STRIPE_STANDARD_PRICE_ID
    : process.env.STRIPE_PREMIUM_PRICE_ID;

  if (!SUBSCRIPTION_PRICE_ID) {
    return res.status(500).json({
      error: `Missing env var STRIPE_${plan.toUpperCase()}_PRICE_ID. Add the recurring Price ID in Vercel.`
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

    // ─── Build line_items ─────────────────────────────────────────
    const lineItems = [];
    let chargeTodayCents = 0;

    // 1. Activation fee ($1) — only on 'activate' flow
    if (flow === 'activate') {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'TapMyCar tag activation' },
          unit_amount: ACTIVATION_FEE_CENTS
        },
        quantity: 1
      });
      chargeTodayCents += ACTIVATION_FEE_CENTS;
    }

    // 2. Sticker fee — charged today on direct flow, or on activate+prepay flow
    if (flow === 'direct' || (flow === 'activate' && prepay)) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `${plan === 'standard' ? 'Standard' : 'Premium'} sticker` },
          unit_amount: STICKER
        },
        quantity: 1
      });
      chargeTodayCents += STICKER;
    }

    // 3. Year 1 prepay — if user opts to pay year 1 upfront
    if (prepay) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription` },
          unit_amount: YEARLY
        },
        quantity: 1
      });
      chargeTodayCents += YEARLY;
    }

    // 4. Referral discount — applied to first one-time line item
    if (referral_discount && referral_discount > 0 && lineItems.length > 0 && lineItems[0].price_data) {
      const discount = Math.min(Math.round(referral_discount * 100), lineItems[0].price_data.unit_amount - 1);
      if (discount > 0) {
        lineItems[0].price_data.unit_amount -= discount;
        chargeTodayCents -= discount;
      }
    }

    // 5. THE RECURRING SUBSCRIPTION — goes in line_items with just the price ID
    lineItems.push({
      price: SUBSCRIPTION_PRICE_ID,
      quantity: 1
    });

    // Trial days:
    //   prepay = year 1 is paid today, so first recurring charge is at day 365
    //   no prepay = first recurring charge hits at day 30 (sticker ships/service starts)
    const trialDays = prepay ? 365 : 30;

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      subscription_data: {
        trial_period_days: trialDays,
        metadata: { user_id, plan, flow, prepay: prepay ? 'true' : 'false' }
      },
      shipping_address_collection: { allowed_countries: ['US'] },
      metadata: {
        user_id,
        plan,
        flow,
        prepay: prepay ? 'true' : 'false',
        charge_today_cents: String(chargeTodayCents),
        referral_discount: String(referral_discount || 0)
      },
      success_url: `${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}`,
      cancel_url: `${req.headers.origin}/pricing.html`
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url, charge_today_cents: chargeTodayCents });

  } catch (err) {
    console.error('create-checkout error:', err.message, err.type);
    return res.status(500).json({ error: err.message });
  }
};
