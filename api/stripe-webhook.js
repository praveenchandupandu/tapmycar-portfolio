const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * TapMyCar Stripe Webhook — v3.0 FINAL
 * ══════════════════════════════════════════════════════════════
 * Implements the authoritative pricing spec:
 *   - Direct flow: Day 0 sticker + activation; Day 30 first annual
 *   - Activate flow: Day 0 $1 (free stays); Day 30 sticker+upgrade; Day 60 annual
 *   - Premium: generates 3 gift codes
 *
 * CRITICAL: The `config` export at the bottom uses the correct pattern so
 * that Vercel respects bodyParser:false (required for Stripe signature verification).
 */

// ─── RAW BODY READER (for Stripe signature verification) ────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── GENERATE A RANDOM PREMIUM GIFT CODE ───────────────────────
function generatePremiumCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O/1/I)
  let out = 'TMC-PREM-';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ─── HANDLER ────────────────────────────────────────────────────
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

  try {
    switch (event.type) {

      // ═════════════════════════════════════════════════════════
      // CHECKOUT COMPLETED (Day 0 of any paid flow)
      // ═════════════════════════════════════════════════════════
      case "checkout.session.completed": {
        const session = event.data.object;
        const { user_id, plan, flow, prepay, sticker_count } = session.metadata || {};
        if (!user_id || !plan || !flow) {
          console.warn("Missing metadata on session:", session.id);
          break;
        }

        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['subscription']
        });
        const ship = fullSession.shipping_details || null;
        const subscription = fullSession.subscription;
        const subId = subscription ? (typeof subscription === 'string' ? subscription : subscription.id) : null;
        const nStickers = parseInt(sticker_count || '1', 10);

        // DETERMINE WHAT PLAN THE USER IS ON AFTER DAY 0
        // - direct flow: user gets the plan immediately
        // - activate flow: user stays on 'etag' (free) for 30 days; day-30 invoice upgrades them
        const userPlanNow = flow === 'direct' ? plan : 'etag';
        const tagStatus = 'active';  // all paid flows activate the tag immediately

        // ORDER — record the Day-0 payment
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

        // TAG — activate immediately for all paid flows
        await supabase.from("tags").update({
          status: tagStatus,
          activated_at: new Date().toISOString(),
          plan: userPlanNow
        }).eq("owner_id", user_id);

        // USER — update plan + subscription id
        const userUpdates = { plan: userPlanNow };
        if (subId) userUpdates.subscription_id = subId;
        await supabase.from("users").update(userUpdates).eq("id", user_id);

        console.log(`✓ User ${user_id}: flow=${flow} plan=${userPlanNow} (will become ${plan}) subId=${subId}`);

        // ─── PREMIUM: generate 3 gift codes ───────────────────
        let premiumCodes = [];
        if (plan === 'premium' && orderRow) {
          for (let i = 0; i < 3; i++) {
            let code = generatePremiumCode();
            // Retry if duplicate (very rare but handle it)
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
          // Assign the first code to the buyer themselves so they have their own sticker linked
          if (premiumCodes.length > 0) {
            await supabase.from('premium_codes')
              .update({ redeemed_by_user_id: user_id, redeemed_at: new Date().toISOString() })
              .eq('code', premiumCodes[0]);
            await supabase.from('users')
              .update({ redeemed_code: premiumCodes[0] })
              .eq('id', user_id);
          }
          console.log(`✓ Generated ${premiumCodes.length} Premium codes for ${user_id}`);
        }

        // REFERRAL REWARDS
        const { data: buyer } = await supabase.from("users").select("referred_by").eq("id", user_id).single();
        if (buyer && buyer.referred_by) {
          const { data: referrer } = await supabase.from("users")
            .select("id, referral_count, referral_credits, referral_reward_pending")
            .eq("referral_code", buyer.referred_by).single();
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            const updates = { referral_count: newCount };
            if (newCount === 1) {
              updates.referral_credits = (referrer.referral_credits || 0) + 3.00;
            } else {
              updates.referral_reward_pending = "choice";
            }
            await supabase.from("users").update(updates).eq("id", referrer.id);
          }
        }

        // CONFIRMATION EMAIL
        const { data: orderUser } = await supabase.from("users").select("*").eq("id", user_id).single();
        if (orderUser && orderUser.email) {
          const html = buildOrderEmail({
            plan, flow, prepay: prepay === 'true',
            amountToday: ((session.amount_total || 0) / 100).toFixed(2),
            shipName: ship ? ship.name : '',
            shipAddress: ship ? `${ship.address.line1}, ${ship.address.city}, ${ship.address.state} ${ship.address.postal_code}` : '',
            premiumCodes: premiumCodes.slice(1)  // codes 2 and 3 are the shareable ones (1 is the buyer's own)
          });
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: orderUser.email,
            subject: plan === 'premium' ? `Welcome to Premium · 3 gift codes inside` : `Order confirmed · TapMyCar ${plan[0].toUpperCase() + plan.slice(1)}`,
            html
          });
        }

        break;
      }

      // ═════════════════════════════════════════════════════════
      // INVOICE PAYMENT SUCCEEDED
      // Day 30: trial-end invoice charges sticker + starts subscription (activate flow)
      //         or just starts subscription (direct flow)
      // Later: annual renewals
      // ═════════════════════════════════════════════════════════
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const billingReason = invoice.billing_reason;

        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
        if (!user) break;

        // Retrieve subscription to check its metadata (flow, plan)
        let subFlow, subPlan;
        if (invoice.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription);
            subFlow = sub.metadata?.flow;
            subPlan = sub.metadata?.plan;
          } catch (e) { /* fall through */ }
        }

        // FIRST invoice at trial end → for activate flow, this is day 30 "upgrade"
        if (billingReason === 'subscription_create' || billingReason === 'subscription_cycle') {
          // If this is the activate flow's trial-end invoice, upgrade the user's plan now
          if (subFlow === 'activate' && subPlan && user.plan === 'etag') {
            await supabase.from("users").update({ plan: subPlan }).eq("id", user.id);
            await supabase.from("tags").update({ plan: subPlan }).eq("owner_id", user.id);
            console.log(`✓ User ${user.id} upgraded from etag → ${subPlan} at trial-end (day 30)`);

            // Email the "sticker shipped, plan active" confirmation
            if (user.email) {
              await resend.emails.send({
                from: "TapMyCar <noreply@tapmycar.io>",
                to: user.email,
                subject: `Welcome to ${subPlan[0].toUpperCase() + subPlan.slice(1)} · Your sticker ships now`,
                html: buildStickerShippingEmail(subPlan)
              });
            }
          }

          // Record invoice as order
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
        }

        // Renewal email (only on actual cycle, not first trial-end)
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
          // Disable main user's tag
          await supabase.from("tags").update({ status: "disabled" }).eq("owner_id", user.id);
          await supabase.from("users").update({ subscription_id: null, plan: 'etag' }).eq("id", user.id);

          // If Premium main buyer: also disable family members' tags
          if (user.plan === 'premium') {
            const { data: familyMembers } = await supabase.from('users').select('id').eq('parent_user_id', user.id);
            if (familyMembers && familyMembers.length > 0) {
              const familyIds = familyMembers.map(f => f.id);
              await supabase.from('tags').update({ status: 'disabled' }).in('owner_id', familyIds);
              await supabase.from('users').update({ plan: 'etag' }).in('id', familyIds);
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

// ─── VERCEL EXPORT (CRITICAL PATTERN) ───────────────────────────
module.exports = handler;
module.exports.config = {
  api: { bodyParser: false }
};

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
    if (prepay) {
      nextLine = `You've prepaid year 1. Your ${planName} physical ${plan === 'premium' ? 'stickers ship' : 'sticker ships'} in 2-3 days. Your first annual renewal is in ~395 days.`;
    } else {
      nextLine = `Your tag is active now (day 1 of 30). On day 30, we'll charge ${sticker} and ship your ${planName} ${plan === 'premium' ? 'stickers' : 'sticker'}, upgrading you to the ${planName} plan. On day 60, your ${yearly}/year annual plan begins.`;
    }
  } else {
    hdr = `Welcome to ${planName}`;
    if (prepay) {
      nextLine = `You've prepaid year 1. Your ${plan === 'premium' ? '3 physical stickers ship' : 'physical sticker ships'} in 2-3 business days. Your first annual renewal is in 365 days.`;
    } else {
      nextLine = `Your ${plan === 'premium' ? '3 physical stickers ship' : 'physical sticker ships'} in 2-3 business days. On day 30, your first annual charge of ${yearly} begins your subscription, which renews yearly.`;
    }
  }

  const codesBlock = premiumCodes && premiumCodes.length > 0 ? `
    <div style="background:#F3F4F6;border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:10px">Your 2 Premium gift codes (for family)</div>
      <div style="font-size:11px;color:#6B7280;margin-bottom:12px">Share these codes with 2 family members. They register at tapmycar.io and enter their code to claim their own Premium sticker. All managed under your Premium subscription.</div>
      ${premiumCodes.map(c => `<div style="background:#fff;border:1.5px dashed #D1D5DB;border-radius:8px;padding:10px;margin-bottom:8px;text-align:center;font-family:monospace;font-size:15px;font-weight:700;color:#111">${c}</div>`).join('')}
    </div>
  ` : '';

  return `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#fff">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:16px">${hdr}</div>
    <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:4px">Paid today: $${amountToday}</div>
      <div style="font-size:12px;color:#166534">Plan: ${planName}</div>
    </div>
    ${shipAddress ? `<div style="background:#F9FAFB;border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:#111;margin-bottom:4px">Shipping to</div>
      <div style="font-size:12px;color:#6B7280">${shipName}, ${shipAddress}</div>
    </div>` : ''}
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
    <div style="background:#F9FAFB;border-radius:12px;padding:14px;margin-bottom:16px;font-size:12px;color:#6B7280;line-height:1.6">In 30 days, your first annual charge of ${yearly} begins your subscription. After that, it renews yearly. Cancel anytime.</div>
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
      <div style="font-size:12px;color:#B91C1C">We could not process your charge. Please update your payment method to keep your tag active.</div>
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
      <div style="font-size:12px;color:#6B7280">Your tag is now inactive. You will not be charged again. Reactivate anytime from the dashboard.</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Reactivate</a>
  </div>`;
}
