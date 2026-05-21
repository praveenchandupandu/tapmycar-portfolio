const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const crypto = require('crypto');
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * TapMyCar Stripe Webhook — v4.0 FINAL
 * ══════════════════════════════════════════════════════════════
 * ARCHITECTURE:
 *   - Checkout runs in `mode: 'payment'` (one-time charge for sticker)
 *   - After payment succeeds, THIS webhook creates the recurring subscription
 *     with trial_period_days set appropriately (30 or 395 depending on prepay)
 *   - This makes the Stripe checkout UI display clean "Pay $9.99" instead of
 *     confusing "$9.99 per year" language.
 */

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function generatePremiumCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'TMC-PREM-';
  for (let i = 0; i < 6; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).json({ error: err.message });
  }

  console.log(`Webhook: ${event.type}`);

  // TMC_PATCH28_WEBHOOK_IDEMPOTENT: idempotency — reject duplicate event deliveries.
  // Stripe retries webhooks on timeout/non-2xx. Without this, we would
  // process the same event twice and create duplicate subscriptions.
  try {
    const { data: existing, error: existsErr } = await supabase
      .from('webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();
    if (existsErr) {
      console.warn('idempotency check failed (continuing):', existsErr.message);
    } else if (existing) {
      console.log(`Webhook ${event.id} already processed, skipping`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    // Best-effort: mark this event id as in-progress.
    // If insertion fails due to race (PK violation), another worker is
    // already handling it -> we should also bail out.
    const { error: insertErr } = await supabase
      .from('webhook_events')
      .insert({ event_id: event.id, type: event.type });
    if (insertErr) {
      console.log(`Webhook ${event.id} insert failed (race?): ${insertErr.message}, skipping`);
      return res.status(200).json({ received: true, race: true });
    }
  } catch (idempErr) {
    console.warn('idempotency error (continuing):', idempErr && idempErr.message);
    // Do NOT block processing on idempotency-infra failure. Better to
    // double-process rarely than to drop events entirely.
  }

  try {
    switch (event.type) {

      // ═════════════════════════════════════════════════════════
      // CHECKOUT COMPLETED — one-time payment succeeded
      // ═════════════════════════════════════════════════════════
      case "checkout.session.completed": {
        const session = event.data.object;
        const { user_id, plan, flow, prepay, sticker_count, subscription_price_id, activation_session_id, tag_token } = session.metadata || {};
        if (!user_id || !plan || !flow) {
          console.warn("Missing metadata on session:", session.id);
          break;
        }

        // shipping_details is already on the session object, no expand needed
        const ship = session.shipping_details || session.collected_information?.shipping_details || null;
        const nStickers = parseInt(sticker_count || '1', 10);
        const isPrepay = prepay === 'true';

        // ─── CREATE THE SUBSCRIPTION (saved card from one-time payment) ──
        // For activate flow no-prepay: trial = 30 days (sticker charge fires at trial-end)
        // For direct flow no-prepay: trial = 30 days (annual charge fires at trial-end)
        // For any prepay: trial = 395 days (activate) or 365 days (direct)
        let trialDays;
        if (flow === 'activate') {
          trialDays = isPrepay ? 395 : 30;
        } else {
          trialDays = isPrepay ? 365 : 30;
        }

        let subscription;
        try {
          const subParams = {
            customer: session.customer,
            items: [{ price: subscription_price_id }],
            trial_period_days: trialDays,
            metadata: { user_id, plan, flow, prepay }
          };

          // For activate flow without prepay, the sticker fee hits at trial-end (day 30) as add_invoice_items
          if (flow === 'activate' && !isPrepay) {
            const STICKER = plan === 'standard' ? 999 : 2499;
            const stickerProductName = plan === 'standard' ? 'Standard sticker' : 'Premium 3 stickers';
            const stickerProduct = await getOrCreateProduct(`tapmycar_${plan}_sticker`, stickerProductName);
            subParams.add_invoice_items = [{
              price_data: {
                currency: 'usd',
                product: stickerProduct,
                unit_amount: STICKER,
                tax_behavior: 'unspecified'
              },
              quantity: 1
            }];
          }

          subscription = await stripe.subscriptions.create(subParams);
          console.log(`✓ Created subscription ${subscription.id} for ${user_id} (trial ${trialDays}d)`);
        } catch (subErr) {
          console.error("Failed to create subscription:", subErr.message);
          // Continue anyway — we'll still record the order and activate the tag
        }

        const subId = subscription?.id || null;

        // ─── DETERMINE PLAN STATE AFTER DAY 0 ──────────────────
        // direct flow: user gets plan immediately
        // activate flow: user stays on 'etag' for 30 days; upgrade happens at trial-end invoice
        const userPlanNow = flow === 'direct' ? plan : 'etag';

        // ─── ORDER RECORD ──────────────────────────────────────
        const { data: orderRow } = await supabase.from("orders").insert({
          user_id,
          plan,
          amount: session.amount_total,
          stripe_id: session.id,
          subscription_id: subId,
          status: "paid",
          shipping_name: ship ? ship.name : null,
          shipping_address: ship ? ship.address.line1 + (ship.address.line2 ? ' ' + ship.address.line2 : '') : null,
          shipping_city: ship ? ship.address.city : null,
          shipping_state: ship ? ship.address.state : null,
          shipping_zip: ship ? ship.address.postal_code : null,
          shipping_fee: 0,
          sticker_count: nStickers,
          order_status: flow === 'activate' ? 'pending_sticker' : 'processing'
        }).select().single();
        // TMC_PATCH7_ACTIVATE_SMS: validate and consume the activation_session_id from
        // pre-checkout SMS verification. If invalid, log a critical error
        // and DO NOT activate the tag. Customer paid but tag stays unclaimed.
        // (Refund handling is a future concern; for now: alert via console
        // and let the customer contact support.)
        if (activation_session_id) {
          try {
            const { data: actSession } = await supabase
              .from('activation_sessions')
              .select('id, user_id, created_at, used')
              .eq('id', activation_session_id)
              .maybeSingle();

            const ageMs = actSession ? Date.now() - new Date(actSession.created_at).getTime() : Infinity;
            const valid = actSession &&
              actSession.user_id === user_id &&
              !actSession.used &&
              ageMs <= 15 * 60 * 1000;

            if (!valid) {
              console.error('PATCH7 CRITICAL: activation_session_id invalid for paid checkout', {
                session_id: activation_session_id,
                user_id,
                tag_token,
                reason: !actSession ? 'not found' : actSession.user_id !== user_id ? 'user mismatch' : actSession.used ? 'already used' : 'expired'
              });
              break;
            }

            await supabase
              .from('activation_sessions')
              .update({ used: true, used_at: new Date().toISOString() })
              .eq('id', activation_session_id)
              .eq('used', false);
          } catch (sessionErr) {
            console.error('PATCH7 CRITICAL: activation_session validation threw', sessionErr.message);
            break;
          }
        } else {
          // TMC_PATCH8_HOTFIX: do NOT break here. pricing.html does not yet pass
          // activation_session_id, so requiring it would block legitimate
          // direct-flow purchases. Log a warning and continue with activation.
          // Once pricing.html is updated to pass session_id (future patch),
          // this branch should rarely fire for legitimate flows.
          console.warn('PATCH8: checkout completed without activation_session_id (allowing for backwards compat)', {
            user_id,
            tag_token,
            session_id: session.id,
            flow
          });
        }

        // ─── ACTIVATE TAG ──────────────────────────────────────
        await supabase.from("tags").update({
          status: "active",
          activated_at: new Date().toISOString(),
          plan: userPlanNow
        }).eq("owner_id", user_id);

        // ─── UPDATE USER ───────────────────────────────────────
        const userUpdates = { plan: userPlanNow };
        if (subId) userUpdates.subscription_id = subId;
        await supabase.from("users").update(userUpdates).eq("id", user_id);

        console.log(`✓ User ${user_id}: flow=${flow} plan=${userPlanNow} subId=${subId}`);

        // ─── PREMIUM: GENERATE 3 GIFT CODES ─────────────────────
        let premiumCodes = [];
        if (plan === 'premium' && orderRow) {
          for (let i = 0; i < 3; i++) {
            let code = generatePremiumCode();
            for (let attempts = 0; attempts < 5; attempts++) {
              const { data: existing } = await supabase.from('premium_codes').select('id').eq('code', code).maybeSingle();
              if (!existing) break;
              code = generatePremiumCode();
            }
            const { data: codeRow } = await supabase.from('premium_codes').insert({
              code,
              buyer_user_id: user_id,
              buyer_order_id: orderRow.id
            }).select().single();
            if (codeRow) premiumCodes.push(codeRow.code);
          }
          // First code auto-assigned to buyer
          if (premiumCodes.length > 0) {
            await supabase.from('premium_codes')
              .update({ redeemed_by_user_id: user_id, redeemed_at: new Date().toISOString() })
              .eq('code', premiumCodes[0]);
            await supabase.from('users').update({ redeemed_code: premiumCodes[0] }).eq('id', user_id);
          }
          console.log(`✓ Generated ${premiumCodes.length} Premium codes`);
        }

        // ─── REFERRAL REWARDS ───────────────────────────────────
        const { data: buyer } = await supabase.from("users").select("referred_by").eq("id", user_id).single();
        if (buyer && buyer.referred_by) {
          const { data: referrer } = await supabase.from("users")
            .select("id, referral_count, referral_credits, referral_reward_pending")
            .eq("referral_code", buyer.referred_by).single();
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            const updates = { referral_count: newCount };
            if (newCount === 1) updates.referral_credits = (referrer.referral_credits || 0) + 3.00;
            else updates.referral_reward_pending = "choice";
            await supabase.from("users").update(updates).eq("id", referrer.id);
          }
        }

        // ─── CONFIRMATION EMAIL ────────────────────────────────
        const { data: orderUser } = await supabase.from("users").select("*").eq("id", user_id).single();
        if (orderUser && orderUser.email) {
          const html = buildOrderEmail({
            plan, flow, prepay: isPrepay,
            amountToday: ((session.amount_total || 0) / 100).toFixed(2),
            shipName: ship ? ship.name : '',
            shipAddress: ship ? `${ship.address.line1}, ${ship.address.city}, ${ship.address.state} ${ship.address.postal_code}` : '',
            premiumCodes: premiumCodes.slice(1)
          });
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: orderUser.email,
            subject: plan === 'premium' ? `Welcome to Premium · 2 gift codes inside` : `Order confirmed · TapMyCar ${plan[0].toUpperCase() + plan.slice(1)}`,
            html
          });
        }
        break;
      }

      // ═════════════════════════════════════════════════════════
      // INVOICE PAYMENT SUCCEEDED (trial-end or annual renewal)
      // ═════════════════════════════════════════════════════════
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const billingReason = invoice.billing_reason;

        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", invoice.customer).single();
        if (!user) break;

        let subFlow, subPlan;
        if (invoice.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription);
            subFlow = sub.metadata?.flow;
            subPlan = sub.metadata?.plan;
          } catch (e) { /* fall through */ }
        }

        // Activate flow trial-end: upgrade user from 'etag' → their chosen plan
        if (subFlow === 'activate' && subPlan && user.plan === 'etag') {
          await supabase.from("users").update({ plan: subPlan }).eq("id", user.id);
          await supabase.from("tags").update({ plan: subPlan }).eq("owner_id", user.id);
          console.log(`✓ User ${user.id} upgraded from etag → ${subPlan}`);

          if (user.email) {
            await resend.emails.send({
              from: "TapMyCar <noreply@tapmycar.io>",
              to: user.email,
              subject: `Welcome to ${subPlan[0].toUpperCase() + subPlan.slice(1)} · Your sticker ships now`,
              html: buildStickerShippingEmail(subPlan)
            });
          }
        }

        await supabase.from("orders").insert({
          user_id: user.id,
          plan: user.plan || subPlan || 'unknown',
          amount: invoice.amount_paid,
          stripe_id: invoice.id,
          subscription_id: invoice.subscription,
          status: "paid",
          order_status: billingReason === 'subscription_cycle' ? 'delivered' : 'processing',
          shipping_fee: 0
        });

        if (billingReason === 'subscription_cycle' && user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Your TapMyCar subscription renewed",
            html: buildRenewalEmail((invoice.amount_paid / 100).toFixed(2))
          });
        }

        await supabase.from("tags").update({ status: "active" }).eq("owner_id", user.id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", invoice.customer).single();
        if (user && user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Action required — TapMyCar payment failed",
            html: buildPaymentFailedEmail()
          });
        }
        break;
      }

      case "invoice.upcoming": {
        const invoice = event.data.object;
        const amount = (invoice.amount_due / 100).toFixed(2);
        const dueDate = new Date(invoice.period_end * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", invoice.customer).single();
        if (user && user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Your TapMyCar renewal is coming up",
            html: buildRenewalReminderEmail(amount, dueDate)
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", subscription.customer).single();
        if (user) {
          await supabase.from("tags").update({ status: "disabled" }).eq("owner_id", user.id);
          await supabase.from("users").update({ subscription_id: null, plan: 'etag' }).eq("id", user.id);

          if (user.plan === 'premium') {
            const { data: fam } = await supabase.from('users').select('id').eq('parent_user_id', user.id);
            if (fam && fam.length > 0) {
              const ids = fam.map(f => f.id);
              await supabase.from('tags').update({ status: 'disabled' }).in('owner_id', ids);
              await supabase.from('users').update({ plan: 'etag' }).in('id', ids);
            }
          }

          if (user.email) {
            await resend.emails.send({
              from: "TapMyCar <noreply@tapmycar.io>",
              to: user.email,
              subject: "Your TapMyCar subscription is cancelled",
              html: buildCancelConfirmationEmail()
            });
          }
        }
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });

  } catch (err) {
    console.error(`Webhook handler error on ${event.type}:`, err);
    return res.status(200).json({ received: true, handler_error: err.message });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
async function getOrCreateProduct(lookupKey, name) {
  try {
    const existing = await stripe.products.search({ query: `metadata['lookup_key']:'${lookupKey}'`, limit: 1 });
    if (existing.data.length > 0) return existing.data[0].id;
  } catch (e) { /* fall through */ }
  const product = await stripe.products.create({ name, metadata: { lookup_key: lookupKey } });
  return product.id;
}

// ═══════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════
function buildOrderEmail({ plan, flow, prepay, amountToday, shipName, shipAddress, premiumCodes }) {
  const planName = plan === 'standard' ? 'Standard' : plan === 'premium' ? 'Premium' : plan;
  const yearly = plan === 'standard' ? '$9.99' : '$19.99';
  const sticker = plan === 'standard' ? '$9.99' : '$24.99';

  let hdr, nextLine;
  if (flow === 'activate') {
    hdr = 'Activation confirmed';
    nextLine = prepay
      ? `You've prepaid year 1. Your ${planName} physical ${plan === 'premium' ? 'stickers ship' : 'sticker ships'} in 2-3 days. Your first annual renewal is in ~395 days.`
      : `Your tag is active now (day 1 of 30). On day 30, we'll charge ${sticker} and ship your ${planName} ${plan === 'premium' ? 'stickers' : 'sticker'}. On day 60, your ${yearly}/year annual plan begins.`;
  } else {
    hdr = `Welcome to ${planName}`;
    nextLine = prepay
      ? `You've prepaid year 1. Your ${plan === 'premium' ? '3 physical stickers ship' : 'physical sticker ships'} in 2-3 business days. Your first annual renewal is in 365 days.`
      : `Your ${plan === 'premium' ? '3 physical stickers ship' : 'physical sticker ships'} in 2-3 business days. On day 30, your first annual charge of ${yearly} begins your subscription, which renews yearly.`;
  }

  const codesBlock = premiumCodes && premiumCodes.length > 0 ? `
    <div style="background:#F3F4F6;border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:10px">Your 2 Premium gift codes (for family)</div>
      <div style="font-size:11px;color:#6B7280;margin-bottom:12px">Share with 2 family members. Each redeems their code at tapmycar.io to claim their own Premium sticker under your subscription.</div>
      ${premiumCodes.map(c => `<div style="background:#fff;border:1.5px dashed #D1D5DB;border-radius:8px;padding:10px;margin-bottom:8px;text-align:center;font-family:monospace;font-size:15px;font-weight:700;color:#111">${c}</div>`).join('')}
    </div>` : '';

  return `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#fff">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:16px">${hdr}</div>
    <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:4px">Paid today: $${amountToday}</div>
      <div style="font-size:12px;color:#166534">Plan: ${planName}</div>
    </div>
    ${shipAddress ? `<div style="background:#F9FAFB;border-radius:12px;padding:14px;margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#111;margin-bottom:4px">Shipping to</div><div style="font-size:12px;color:#6B7280">${shipName}, ${shipAddress}</div></div>` : ''}
    ${codesBlock}
    <div style="background:#FFF3EC;border:1px solid #FFE4CC;border-radius:12px;padding:14px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#FF6B00;margin-bottom:4px">What happens next</div>
      <div style="font-size:12px;color:#92400E;line-height:1.6">${nextLine}</div>
      <div style="font-size:11px;color:#92400E;margin-top:8px">Cancel anytime in Settings. Physical stickers are non-refundable once shipped.</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Open dashboard</a>
    <div style="margin-top:20px;font-size:10px;color:#9CA3AF;text-align:center">Questions? Email support@tapmycar.io · <a href="https://tapmycar.io/terms.html" style="color:#FF6B00">Terms</a> · <a href="https://tapmycar.io/privacy.html" style="color:#FF6B00">Privacy</a></div>
  </div>`;
}

function buildStickerShippingEmail(plan) {
  const planName = plan === 'standard' ? 'Standard' : 'Premium';
  const sticker = plan === 'standard' ? '$9.99' : '$24.99';
  const yearly = plan === 'standard' ? '$9.99' : '$19.99';
  return `<div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="font-size:18px;font-weight:800;color:#111;margin-bottom:12px">Welcome to ${planName}!</div>
    <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:#9A3800;margin-bottom:4px">Charged today: ${sticker}</div>
      <div style="font-size:12px;color:#78350F">Your ${plan === 'premium' ? '3 physical stickers ship' : 'physical sticker ships'} to your address in 2-3 business days.</div>
    </div>
    <div style="background:#F9FAFB;border-radius:12px;padding:14px;margin-bottom:16px;font-size:12px;color:#6B7280;line-height:1.6">In 30 days, your first annual charge of ${yearly} begins your subscription. Cancel anytime.</div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">View dashboard</a>
  </div>`;
}

function buildRenewalEmail(amount) {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:4px">Subscription renewed — $${amount}</div>
      <div style="font-size:12px;color:#15803D">Your tag is active for another year.</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">View dashboard</a>
  </div>`;
}

function buildPaymentFailedEmail() {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#DC2626;margin-bottom:4px">Payment failed</div>
      <div style="font-size:12px;color:#B91C1C">We could not process your charge. Please update your payment method.</div>
    </div>
    <a href="https://tapmycar.io/settings.html" style="display:block;background:#DC2626;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Update payment method</a>
  </div>`;
}

function buildRenewalReminderEmail(amount, dueDate) {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#FF6B00;margin-bottom:4px">Renewal reminder</div>
      <div style="font-size:12px;color:#92400E">Your TapMyCar subscription renews on ${dueDate} for $${amount}.</div>
    </div>
    <a href="https://tapmycar.io/settings.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Manage subscription</a>
  </div>`;
}

function buildCancelConfirmationEmail() {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Subscription cancelled</div>
      <div style="font-size:12px;color:#6B7280">Your tag is now inactive. You will not be charged again.</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Reactivate</a>
  </div>`;
}
