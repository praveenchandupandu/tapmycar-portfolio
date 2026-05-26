/* TMC_PATCH36B_CANCEL_WORDING */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * TapMyCar Checkout — v4.0 FINAL
 * ══════════════════════════════════════════════════════════════
 * KEY CHANGE FROM v3: We now use `mode: 'payment'` (one-time payment) instead
 * of `mode: 'subscription'`. This makes Stripe's checkout show ONLY the sticker
 * price as the hero ("Pay $9.99"), not the confusing "$9.99 per year" display.
 *
 * The recurring subscription is created AFTER payment succeeds, in the webhook,
 * using the saved card. This is the architecturally-correct way to combine
 * a one-time lifetime charge with a recurring subscription.
 *
 * Flows:
 *   etag_free   — no Stripe
 *   activate    — $1 one-time today (webhook creates subscription with 30-day trial)
 *   direct      — sticker fee one-time today (webhook creates subscription with 30-day trial)
 *   +prepay     — includes year 1 annual in today's charge; webhook uses longer trial (365 days)
 */

const ACTIVATION_FEE = 100;
const STICKER_PRICE = { standard: 999, premium: 2499 };
const ANNUAL_PRICE = { standard: 999, premium: 1999 };

module.exports = async function handler(req, res) {
  /* TMC_PATCH34_AUTOMATIC_TAX: per-item tax code. CT 6.35% standard rate on all items
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

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // TMC_PATCH7_ACTIVATE_SMS: accept activation_session_id + token from body
  const { activation_session_id: _tmcActSession, token: _tmcTagToken } = req.body;
  const { user_id, flow, plan, prepay, referral_discount } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!flow) return res.status(400).json({ error: "flow required: 'etag_free', 'activate', or 'direct'" });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent duplicate purchases (e.g. Standard user trying to buy Standard again)
  if (flow === 'direct' && user.plan === plan) {
    return res.status(400).json({
      error: `You're already on the ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan.`
    });
  }

  // TMC_PATCH28_EXISTING_SUB_GUARD: stronger existing-subscription guard.
  // If the user has a subscription_id, ask Stripe whether it's still active.
  // Active/trialing -> refuse new checkout (prevents Vishnu-style double-pay).
  // Canceled/incomplete_expired/past_due -> allow (user is re-subscribing).
  if ((flow === 'activate' || flow === 'direct') && user.subscription_id) {
    try {
      const existingSub = await stripe.subscriptions.retrieve(user.subscription_id);
      const blockingStatuses = ['active', 'trialing', 'past_due', 'unpaid'];
      if (existingSub && blockingStatuses.indexOf(existingSub.status) >= 0) {
        return res.status(400).json({
          error: 'You already have an active subscription. Manage it in your dashboard.',
          code: 'existing_subscription',
          subscription_status: existingSub.status,
          dashboard_url: '/dashboard.html'
        });
      }
      // Otherwise (canceled, incomplete_expired): fall through and allow new checkout.
    } catch (subErr) {
      // If Stripe says "no such subscription" (id stale), allow checkout.
      // For any other error, log but don't block — we don't want a Stripe
      // outage to lock the user out of paying.
      if (subErr && subErr.code !== 'resource_missing') {
        console.warn('existing-sub check failed (continuing):', subErr.message);
      }
    }
  }

  // ─── FLOW 1: Free eTag ─────────────────────────────────────────
  if (flow === 'etag_free') {
    const { data: tag } = await supabase.from('tags').select('*').eq('owner_id', user_id).eq('status', 'unclaimed').single();
    if (tag) {
      await supabase.from('tags').update({ status: 'claimed', plan: 'etag' }).eq('id', tag.id);
    }
    return res.json({ success: true, redirect: '/etag.html', free: true });
  }

  /* TMC_PATCH35DRENEWFIX2_WHITELIST: allow the renew flow past the whitelist guard */
  /* TMC_PATCH36UPGRADE_STD_TO_PREMIUM: allow upgrade flow */
  if (flow !== 'activate' && flow !== 'direct' && flow !== 'renew' && flow !== 'upgrade') {
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

    // ─── Build one-time payment line items based on flow+plan+prepay ───
    const lineItems = [];
    let chargeTodayCents = 0;

    if (flow === 'activate') {
      // $1 activation fee
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'TapMyCar tag activation',
            description: `$1 activates your tag for 30 days. On day 30 we'll ship your ${plan === 'standard' ? 'Standard' : 'Premium'} sticker and charge ${plan === 'standard' ? '$9.99' : '$24.99'}. On day 60 your annual plan begins at ${plan === 'standard' ? '$9.99' : '$19.99'}/year.`
          },
          unit_amount: ACTIVATION_FEE
        },
        quantity: 1
      }));
      chargeTodayCents += ACTIVATION_FEE;

      if (prepay) {
        // Bundle sticker + year 1 into today's charge
        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan === 'standard' ? 'Standard sticker (lifetime)' : 'Premium 3 stickers (lifetime)'
            },
            unit_amount: STICKER
          },
          quantity: 1
        }));
        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription` },
            unit_amount: ANNUAL
          },
          quantity: 1
        }));
        chargeTodayCents += STICKER + ANNUAL;
      }
    }

    /* TMC_PATCH35DRENEW_GIFT_RENEWAL: renewal flow — annual fee ONLY, no sticker, no shipping.
       The gift recipient already has the sticker; this just pays for the
       year of service and reactivates their tag. */
    /* TMC_PATCH36UPGRADE_STD_TO_PREMIUM: Standard -> Premium upgrade. 2 extra stickers ($19.99)
       + annual difference (prorated for paying users, full for gift users). */
    if (flow === 'upgrade') {
      /* 2 additional stickers — flat $19.99 */
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
      let annualDesc = 'Your Premium plan for one year. Not satisfied? Request a refund within 14 days — a $1 service fee is retained. After 14 days, the plan is non-refundable.';

      const hadSub = user.subscription_id && String(user.plan || '').toLowerCase() === 'standard';
      if (hadSub) {
        /* PAYING Standard user — prorate the $10/yr difference. */
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
          console.error('TMC_PATCH36UPGRADE_STD_TO_PREMIUM: subscription retrieve failed, flat fallback:', subErr && subErr.message);
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

    if (flow === 'renew') {
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard — annual plan (reactivate your tag)'
              : 'TapMyCar Premium — annual plan (reactivate your tag)',
            description: 'Renews your TapMyCar service for one year and reactivates the tag you already have. Not satisfied? Request a refund within 14 days — a $1 service fee is retained. After 14 days, the plan is non-refundable.'
          },
          unit_amount: ANNUAL
        },
        quantity: 1
      }));
      chargeTodayCents += ANNUAL;
    }

    if (flow === 'direct') {
      // Sticker fee today
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan === 'standard'
              ? 'TapMyCar Standard — 1 physical NFC + QR sticker (lifetime)'
              : 'TapMyCar Premium — 3 physical NFC + QR stickers (lifetime, for family)',
            description: plan === 'standard'
              ? `Ships in 2-3 business days. On day 30, your $9.99/year annual plan begins. Request a refund within 14 days — a $1 service fee is retained; non-refundable after that.`
              : `Ships in 2-3 business days. Comes with 3 gift codes to share with family. On day 30, your $19.99/year annual plan begins. Request a refund within 14 days — a $1 service fee is retained; non-refundable after that.`
          },
          unit_amount: STICKER
        },
        quantity: 1
      }));
      chargeTodayCents += STICKER;

      if (prepay) {
        lineItems.push(_withTax({
          price_data: {
            currency: 'usd',
            product_data: { name: `Year 1 ${plan === 'standard' ? 'Standard' : 'Premium'} annual subscription` },
            unit_amount: ANNUAL
          },
          quantity: 1
        }));
        chargeTodayCents += ANNUAL;
      }
    }

    // Apply referral discount
    if (referral_discount && referral_discount > 0 && lineItems.length > 0 && lineItems[0].price_data) {
      const discount = Math.min(Math.round(referral_discount * 100), lineItems[0].price_data.unit_amount - 1);
      if (discount > 0) {
        lineItems[0].price_data.unit_amount -= discount;
        chargeTodayCents -= discount;
      }
    }

    // ─── ONE-TIME PAYMENT MODE (not subscription!) ───────────────
    // This is the critical change: Stripe shows "Pay $9.99" cleanly, not "$9.99 per year".
    // The subscription is created by the webhook after payment succeeds.
    const sessionParams = {
      mode: 'payment',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: lineItems,
      payment_intent_data: {
        // Save the card to the customer so the webhook can create a subscription later
        setup_future_usage: 'off_session'
      },
      /* TMC_PATCH35DRENEW_GIFT_RENEWAL: renew flow ships nothing — skip shipping address */
      ...(flow === 'renew' ? {} : { shipping_address_collection: { allowed_countries: ['US'] } }),
      billing_address_collection: 'required',
      /* TMC_PATCH34_AUTOMATIC_TAX: Stripe Tax — calculates tax based on shipping address */
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', shipping: 'auto', name: 'auto' },
      metadata: {
        user_id,
        plan,
        flow,
        // TMC_PATCH7_ACTIVATE_SMS: pass through to webhook for activation gate
        activation_session_id: _tmcActSession || '',
        tag_token: _tmcTagToken || '',
        prepay: prepay ? 'true' : 'false',
        charge_today_cents: String(chargeTodayCents),
        sticker_count: plan === 'premium' ? '3' : '1',
        subscription_price_id: SUB_PRICE_ID,
        referral_discount: String(referral_discount || 0)
      },
      success_url: `https://tapmycar.io/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}${prepay ? '&prepay=1' : ''}`,
      cancel_url: `https://tapmycar.io/pricing.html`
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url, charge_today_cents: chargeTodayCents });

  } catch (err) {
    console.error('create-checkout error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
