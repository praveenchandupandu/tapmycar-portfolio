const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * TapMyCar Stripe Webhook — v2.2
 * ═══════════════════════════════
 * CRITICAL: Vercel's `config` export must be a separate top-level assignment,
 * NOT attached to an arrow function or `module.exports = function`. Otherwise
 * Vercel JSON-parses the body before our handler sees it, and Stripe's signature
 * verification fails.
 *
 * Events handled:
 *   checkout.session.completed   → Day-0 purchase: record order, activate tag, update user.plan
 *   invoice.payment_succeeded    → trial-end or annual renewal
 *   invoice.payment_failed       → notify user
 *   invoice.upcoming             → renewal reminder
 *   customer.subscription.deleted → cancel
 */

// ─── RAW BODY READER ───────────────────────────────────────
// Collects the raw bytes of the POST body before Vercel parses anything.
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─── HANDLER ───────────────────────────────────────────────
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

  console.log(`Webhook received: ${event.type}`);

  try {
    switch (event.type) {

      // ─────────────────────────────────────────────────────
      // CHECKOUT COMPLETED — Day 0 purchase
      // ─────────────────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object;
        const { user_id, plan, flow, prepay } = session.metadata || {};
        if (!user_id || !plan || !flow) {
          console.warn("Missing metadata on session:", session.id);
          break;
        }

        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['shipping_details', 'subscription', 'customer_details']
        });
        const ship = fullSession.shipping_details || null;
        const subscription = fullSession.subscription;
        const subId = subscription ? (typeof subscription === 'string' ? subscription : subscription.id) : null;

        // ORDER
        await supabase.from("orders").insert({
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
          order_status: 'processing'
        });

        // TAG — activate NOW (payment confirmed)
        await supabase.from("tags").update({
          status: "active",
          activated_at: new Date().toISOString(),
          plan
        }).eq("owner_id", user_id);

        // USER — update plan + subscription id
        const userUpdates = { plan };
        if (subId) userUpdates.subscription_id = subId;
        await supabase.from("users").update(userUpdates).eq("id", user_id);

        console.log(`✓ Activated user ${user_id} on ${plan} plan (flow=${flow}, prepay=${prepay})`);

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
          const planName = plan === 'standard' ? 'Standard' : plan === 'premium' ? 'Premium' : plan;
          const shipInfo = ship ? `${ship.name}, ${ship.address.line1}, ${ship.address.city}, ${ship.address.state} ${ship.address.postal_code}` : null;
          const amountToday = ((session.amount_total || 0) / 100).toFixed(2);
          const nextChargeLine = nextChargeDescription(flow, plan, prepay === 'true');

          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: orderUser.email,
            subject: `Order confirmed · TapMyCar ${planName}`,
            html: buildOrderEmail({ planName, amountToday, shipInfo, nextChargeLine, flow, prepay: prepay === 'true' })
          });
        }

        // ADMIN NOTIFICATION
        if (process.env.ADMIN_EMAIL) {
          await resend.emails.send({
            from: "TapMyCar Orders <noreply@tapmycar.io>",
            to: process.env.ADMIN_EMAIL,
            subject: `New order: ${plan} (${flow}${prepay === 'true' ? ' + prepay' : ''})`,
            html: `<p>User: ${orderUser?.email || user_id}<br>Plan: ${plan}<br>Flow: ${flow}<br>Prepaid: ${prepay}<br>Amount today: $${((session.amount_total || 0) / 100).toFixed(2)}<br>Ship to: ${ship ? ship.name + ' · ' + ship.address.line1 + ' · ' + ship.address.city + ', ' + ship.address.state + ' ' + ship.address.postal_code : 'N/A'}</p>`
          });
        }

        break;
      }

      // ─────────────────────────────────────────────────────
      // INVOICE PAYMENT SUCCEEDED — trial-end or annual renewal
      // ─────────────────────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const billingReason = invoice.billing_reason;

        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", customerId).single();
        if (!user) break;

        await supabase.from("tags").update({ status: "active" }).eq("owner_id", user.id);

        const isRenewal = billingReason === 'subscription_cycle';

        await supabase.from("orders").insert({
          user_id: user.id,
          plan: user.plan || 'unknown',
          amount: invoice.amount_paid,
          stripe_id: invoice.id,
          subscription_id: invoice.subscription,
          status: "paid",
          order_status: 'delivered',
          shipping_fee: 0
        });

        if (isRenewal && user.email) {
          await resend.emails.send({
            from: "TapMyCar <noreply@tapmycar.io>",
            to: user.email,
            subject: "Your TapMyCar subscription renewed",
            html: buildRenewalEmail((invoice.amount_paid / 100).toFixed(2))
          });
        }
        break;
      }

      // ─────────────────────────────────────────────────────
      // INVOICE PAYMENT FAILED
      // ─────────────────────────────────────────────────────
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

      // ─────────────────────────────────────────────────────
      // INVOICE UPCOMING — renewal reminder
      // ─────────────────────────────────────────────────────
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

      // ─────────────────────────────────────────────────────
      // SUBSCRIPTION DELETED (cancelled)
      // ─────────────────────────────────────────────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const { data: user } = await supabase.from("users").select("*").eq("stripe_customer_id", subscription.customer).single();
        if (user) {
          await supabase.from("tags").update({ status: "disabled" }).eq("owner_id", user.id);
          await supabase.from("users").update({ subscription_id: null, plan: 'etag' }).eq("id", user.id);

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

// ─── CRITICAL VERCEL EXPORT PATTERN ──────────────────────────
// `config` must be attached to the exports object directly, NOT to a function.
// We do this by assigning the handler and config as separate properties on module.exports.
module.exports = handler;
module.exports.config = {
  api: { bodyParser: false }
};

// ────────────────────────────────────────────────────────────
// EMAIL BUILDERS & UTILITIES
// ────────────────────────────────────────────────────────────
function nextChargeDescription(flow, plan, prepay) {
  const yearly = plan === 'standard' ? '$9.99' : '$19.99';
  const sticker = plan === 'standard' ? '$9.99' : '$24.99';
  if (prepay) {
    return `Your next charge is ${yearly} for annual renewal, approximately 365 days from now.`;
  }
  if (flow === 'activate') {
    return `Your next charge will be ${sticker} on day 30 when your physical sticker ships, then ${yearly}/year for the annual service.`;
  }
  if (flow === 'direct') {
    return `Your next charge will be ${yearly} on day 30 when your annual service begins, then ${yearly}/year going forward.`;
  }
  return '';
}

function buildOrderEmail({ planName, amountToday, shipInfo, nextChargeLine, flow, prepay }) {
  const hdr = flow === 'activate' ? 'Activation confirmed' : 'Order confirmed';
  return `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#fff">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="font-size:13px;color:#6B7280;margin-bottom:24px">Privacy for you. Safety for your car.</div>
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:16px">${hdr}</div>
    <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#166534;margin-bottom:8px">Paid today: $${amountToday}</div>
      <div style="font-size:12px;color:#166534">Plan: ${planName}</div>
    </div>
    ${shipInfo ? `<div style="background:#F9FAFB;border-radius:12px;padding:14px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:#111;margin-bottom:4px">Shipping to</div>
      <div style="font-size:12px;color:#6B7280">${shipInfo}</div>
    </div>` : ''}
    ${nextChargeLine ? `<div style="background:#FFF3EC;border:1px solid #FFE4CC;border-radius:12px;padding:14px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#FF6B00;margin-bottom:4px">What happens next</div>
      <div style="font-size:12px;color:#92400E;line-height:1.6">${nextChargeLine}</div>
      <div style="font-size:11px;color:#92400E;margin-top:8px">You can cancel anytime in Settings. Physical stickers cannot be refunded once shipped.</div>
    </div>` : ''}
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Open dashboard</a>
    <div style="margin-top:20px;font-size:10px;color:#9CA3AF;text-align:center">Questions? Reply to this email or contact support@tapmycar.io.<br>See our <a href="https://tapmycar.io/terms.html" style="color:#FF6B00">Terms</a> and <a href="https://tapmycar.io/privacy.html" style="color:#FF6B00">Privacy Policy</a>.</div>
  </div>`;
}

function buildRenewalEmail(amount) {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:4px">Subscription renewed — $${amount}</div>
      <div style="font-size:12px;color:#15803D">Your tag is active for another year. Thank you!</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">View dashboard</a>
  </div>`;
}

function buildPaymentFailedEmail() {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#FEE2E2;border:1.5px solid #FECACA;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#DC2626;margin-bottom:4px">Payment failed</div>
      <div style="font-size:12px;color:#B91C1C">We could not process your renewal. Please update your payment method to keep your tag active.</div>
    </div>
    <a href="https://tapmycar.io/settings.html" style="display:block;background:#DC2626;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Update payment method</a>
  </div>`;
}

function buildRenewalReminderEmail(amount, dueDate) {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#FF6B00;margin-bottom:4px">Renewal reminder</div>
      <div style="font-size:12px;color:#92400E">Your TapMyCar subscription renews on ${dueDate} for $${amount}. No action needed if you want to continue.</div>
    </div>
    <a href="https://tapmycar.io/settings.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Manage subscription</a>
  </div>`;
}

function buildCancelConfirmationEmail() {
  return `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
    <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
    <div style="background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">Subscription cancelled</div>
      <div style="font-size:12px;color:#6B7280">Your tag is now inactive. You will not be charged again. You can reactivate anytime from the dashboard.</div>
    </div>
    <a href="https://tapmycar.io/dashboard.html" style="display:block;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:14px 0;border-radius:13px;text-align:center;text-decoration:none">Reactivate</a>
  </div>`;
}
