/* TMC_PATCH36B_CANCEL_WORDING */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { resolveUser, recordTokenType } = require('./_auth'); /* TMC_PATCH38S4 */

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
  /* TMC_PATCH38S4: identify the caller from a signed session token or a
     legacy UUID. resolveUser() accepts both, so no logged-in user is
     locked out; the resolved id replaces any user_id the request claimed
     (IDOR fix). viaLegacy records which token type, for the counter. */
  const _tmcAuth = resolveUser(req);
  if (!_tmcAuth) return res.status(401).json({ error: 'Authentication required' });
  const user_id = _tmcAuth.userId;
  await recordTokenType(supabase, user_id, _tmcAuth.viaLegacy);

  const { flow, plan, prepay, referral_discount } = req.body;
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
    /* TMC_UPGRADE_FLAT_1499: Standard -> Premium upgrade. Single flat $14.99
       line item that covers 2 extra stickers + Premium features upgrade.
       The new Premium $19.99/yr subscription is created in the webhook on
       payment success, replacing the old Standard $9.99/yr sub. */
    if (flow === 'upgrade') {
      lineItems.push(_withTax({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'TapMyCar Premium upgrade',
            description: '2 additional weatherproof NFC + QR stickers ship in 2-3 business days. Your annual plan changes to Premium ($19.99/yr) starting next renewal. Refundable within 14 days minus the $1 service fee.'
          },
          unit_amount: 1499
        },
        quantity: 1
      }));
      chargeTodayCents += 1499;
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

    /* TMC_PATCH45B: server-side referral credit. The client may pass
       apply_referral_credit:true/false; the *amount* is recomputed here
       from the referrals table  the client cannot inflate it. Credits
       are spent in FIFO order; we collect the row ids so the webhook (or
       the free-flow branch below) can mark them consumed atomically. */
    const applyCredit = req.body.apply_referral_credit !== false; /* default ON */
    let _tmcCreditCents = 0;
    let _tmcCreditRowIds = [];
    if (applyCredit) {
      /* TMC_PATCH46_FIX2: stop collecting at the amount we could possibly
         use for this transaction. Without this, a $9.99 renewal would
         consume $12 of credit (all 4 rows) because the consume step
         flips every collected row.
         maxApply mirrors the math used below the loop. */
      const _tmcFullCover  = (flow === 'renew' || flow === 'upgrade');
      const _tmcMaxApply   = _tmcFullCover ? chargeTodayCents : Math.max(0, chargeTodayCents - 100);
      const nowIso = new Date().toISOString();
      const { data: avRows } = await supabase
        .from('referrals')
        .select('id, credit_amount, status, available_at, credit_kind')
        .eq('referrer_user_id', user_id)
        .in('status', ['pending','available'])
        .order('paid_at', { ascending: true });
      /* TMC_PATCH51A: renewal_only credits are filtered OUT unless flow
         is renew. General (default) credits work on anything. */
      const _tmcIsRenew = (flow === 'renew');
      const usable = (avRows || []).filter(r => {
        const okStatus = r.status === 'available' ||
          (r.status === 'pending' && r.available_at && r.available_at <= nowIso);
        if (!okStatus) return false;
        const kind = r.credit_kind || 'general';
        if (kind === 'renewal_only' && !_tmcIsRenew) return false;
        return true;
      });
      for (const r of usable) {
        if (_tmcCreditCents >= _tmcMaxApply) break;
        _tmcCreditCents += Math.round((parseFloat(r.credit_amount) || 0) * 100);
        _tmcCreditRowIds.push(r.id);
      }
    }

    /* Apply the credit to the first line item (the dominant charge). The
       $1 floor is needed for activate/direct flows so Stripe has a real
       charge to attach the card to; renew/upgrade can go to $0 (handled
       in the free-flow branch below). */
    let _tmcCreditUsedCents = 0;
    if (_tmcCreditCents > 0 && lineItems.length > 0 && lineItems[0].price_data) {
      const firstUnit = lineItems[0].price_data.unit_amount;
      const fullCoverFlows = (flow === 'renew' || flow === 'upgrade');
      const maxApply = fullCoverFlows ? chargeTodayCents : Math.max(0, chargeTodayCents - 100);
      _tmcCreditUsedCents = Math.min(_tmcCreditCents, maxApply);
      if (_tmcCreditUsedCents > 0) {
        /* distribute across line items so each unit_amount stays >= 0 */
        let remaining = _tmcCreditUsedCents;
        for (const li of lineItems) {
          if (remaining <= 0) break;
          if (!li.price_data) continue;
          const take = Math.min(remaining, li.price_data.unit_amount);
          li.price_data.unit_amount -= take;
          remaining -= take;
        }
        chargeTodayCents -= _tmcCreditUsedCents;
      }
    }

    /* FREE-FLOW BRANCH: credit covers the whole price AND the flow is one
       where we don't need a new card on file (renew/upgrade). Skip Stripe
       entirely, run the side-effects inline, mark credits consumed. */
    if (chargeTodayCents === 0 && (flow === 'renew' || flow === 'upgrade')) {
      try {
        if (flow === 'renew') {
          /* mirror the webhook's 'renew' side-effects: subscription create
             (paid today => trial 365d so first cycle bills a year out),
             user plan restore, reactivate gift tag(s), record order. */
          let renewSub = null;
          try {
            renewSub = await stripe.subscriptions.create({
              customer: customerId,
              items: [{ price: SUB_PRICE_ID }],
              trial_period_days: 365,
              metadata: { user_id, plan, flow: 'renew', referral_credit_applied: String(_tmcCreditUsedCents) }
            });
          } catch (e) {
            console.error('p45b free renew: sub create failed:', e.message);
          }
          await supabase.from('users').update({
            plan,
            subscription_id: renewSub ? renewSub.id : null,
            gift_expired_at: null,
            gift_reminders_sent: ''
          }).eq('id', user_id);
          await supabase.from('tags').update({
            status: 'active',
            gift_expired: false
          }).eq('owner_id', user_id).eq('is_gift', true);
          await supabase.from('orders').insert({
            user_id, plan,
            amount: 0,
            stripe_id: 'credit_only_' + Date.now(),
            subscription_id: renewSub ? renewSub.id : null,
            status: 'paid',
            sticker_count: 0,
            order_status: 'renewal'
          });
        } else if (flow === 'upgrade') {
          /* upgrade STD -> Premium fully covered by credit. Flip plan,
             generate 3 Premium codes, claim the first to the buyer,
             record an order. We don't modify the existing subscription's
             price here  that's a follow-up the user's annual renewal
             will pick up. */
          await supabase.from('users').update({ plan: 'premium' }).eq('id', user_id);
          const generatePremiumCode = function () {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = 'TMC-PREM-';
            for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
            return code;
          };
          const { data: orderRow } = await supabase.from('orders').insert({
            user_id, plan: 'premium',
            amount: 0,
            stripe_id: 'credit_only_' + Date.now(),
            subscription_id: user.subscription_id || null,
            status: 'paid',
            sticker_count: 2,
            order_status: 'upgrade'
          }).select().single();
          const premiumCodes = [];
          if (orderRow) {
            for (let i = 0; i < 3; i++) {
              let code = generatePremiumCode();
              for (let a = 0; a < 5; a++) {
                const { data: ex } = await supabase.from('premium_codes').select('id').eq('code', code).maybeSingle();
                if (!ex) break;
                code = generatePremiumCode();
              }
              const { data: cr } = await supabase.from('premium_codes').insert({
                code, buyer_user_id: user_id, buyer_order_id: orderRow.id
              }).select().single();
              if (cr) premiumCodes.push(cr.code);
            }
            if (premiumCodes.length > 0) {
              await supabase.from('premium_codes')
                .update({ redeemed_by_user_id: user_id, redeemed_at: new Date().toISOString() })
                .eq('code', premiumCodes[0]);
              await supabase.from('users').update({ redeemed_code: premiumCodes[0] }).eq('id', user_id);
            }
          }
        }
        /* TMC_PATCH46_FIX3: split-last-row consumption. _tmcCreditCents
           is what we COLLECTED, _tmcCreditUsedCents is what was actually
           APPLIED. The difference is leftover that must come back to the
           user as a new 'available' row. Without this, a $9.99 renewal
           that collects 4x$3 rows ($12) would burn all $12 even though
           only $9.99 was needed.
           Mark all collected rows consumed (clean audit trail), then
           insert a fresh 'available' row for the leftover amount. */
        if (_tmcCreditRowIds.length > 0) {
          await supabase.from('referrals').update({
            status: 'consumed',
            consumed_at: new Date().toISOString()
          }).in('id', _tmcCreditRowIds);
          const _tmcLeftoverCents = _tmcCreditCents - _tmcCreditUsedCents;
          if (_tmcLeftoverCents > 0) {
            const leftoverDollars = (_tmcLeftoverCents / 100).toFixed(2);
            await supabase.from('referrals').insert({
              referrer_user_id: user_id,
              referred_user_id: null,
              referral_code:    'LEFTOVER',
              status:           'available',
              credit_amount:    parseFloat(leftoverDollars),
              /* paid_at is required for FIFO ordering; use now so this
                 leftover gets used LAST among future purchases (we want
                 older real referral rows to be spent first). Wait, 
                 actually FIFO order='asc' means OLDEST paid_at first, so
                 setting paid_at=now makes this the youngest = last. */
              paid_at:          new Date().toISOString(),
              available_at:     new Date().toISOString(),
              applied_at:       new Date().toISOString()
            });
          }
        }
        return res.json({
          free: true,
          redirect: '/payment-success.html?free=1&plan=' + plan + '&flow=' + flow,
          credit_used_cents: _tmcCreditUsedCents
        });
      } catch (e) {
        console.error('p45b free-flow failed:', e && e.message);
        return res.status(500).json({ error: 'Could not complete the free purchase. Please try again or contact support.' });
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
        referral_discount: String(referral_discount || 0),
        /* TMC_PATCH45B: webhook uses these to mark credits consumed after payment. */
        referral_credit_applied: String(_tmcCreditUsedCents || 0),
        referral_credit_row_ids: (_tmcCreditRowIds || []).join(',')
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
