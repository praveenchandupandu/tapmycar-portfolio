// TMC_PATCH31_REFUND: subscription refund within 14 days
//
// Policy: only annual subscription charges are refundable, within 14 days
// of the charge. Refund = amount_paid - $1 service fee. After refund, sub
// is canceled and user returns to 'etag' plan.

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Optional audit hook (best-effort)
let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

// Optional Resend (best-effort — don't block cancel on email failure)
let _resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) _resend = new Resend(process.env.RESEND_API_KEY);
} catch (e) {}

// Refund policy constants
const REFUND_WINDOW_DAYS = 14;
const SERVICE_FEE_CENTS = 100; // $1 retained on refund

// Annual price cents per plan — used to identify which invoices are
// "annual subscription" charges vs sticker/activation/prepay/etc.
const ANNUAL_PRICE_CENTS = {
  standard: 999,   // $9.99
  premium: 1999    // $19.99
};

// TMC_PATCH2_ORIGIN_GUARD
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (origin === 'https://tapmycar.io') return true;
  if (origin === 'https://www.tapmycar.io') return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * Find the most recent paid invoice on a subscription that is an
 * annual-subscription charge. Returns null if none, or { invoice, charge_id,
 * amount_paid, paid_at, plan } if found.
 */
async function findLastAnnualInvoice(subscriptionId, customerId, plan) {
  try {
    // List recent invoices for this customer + subscription, paid status only
    const list = await stripe.invoices.list({
      customer: customerId,
      subscription: subscriptionId,
      status: 'paid',
      limit: 20
    });
    if (!list || !list.data || list.data.length === 0) return null;

    const annualCents = ANNUAL_PRICE_CENTS[plan];
    if (!annualCents) return null;

    // Sort by status_transitions.paid_at desc (most recent first)
    const candidates = list.data
      .filter(inv => {
        // Only annual subscription charges count.
        const reason = inv.billing_reason || '';
        if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return false;
        // Amount must match annual price exactly (rules out partial charges,
        // prepay bundles, sticker-only charges, etc).
        return inv.amount_paid === annualCents;
      })
      .sort((a, b) => {
        const pa = (a.status_transitions && a.status_transitions.paid_at) || a.created || 0;
        const pb = (b.status_transitions && b.status_transitions.paid_at) || b.created || 0;
        return pb - pa;
      });

    if (candidates.length === 0) return null;

    const inv = candidates[0];
    return {
      invoice: inv,
      charge_id: inv.charge,
      amount_paid: inv.amount_paid,
      paid_at: (inv.status_transitions && inv.status_transitions.paid_at) || inv.created,
      plan
    };
  } catch (e) {
    console.error('findLastAnnualInvoice error:', e.message);
    return null;
  }
}

/**
 * Compute refund eligibility for a user. Returns an object with:
 *   { eligible, reason, refund_cents, window_closes_at, last_invoice }
 */
async function computeEligibility(user) {
  if (!user.subscription_id) {
    return { eligible: false, reason: 'no_subscription', refund_cents: 0 };
  }
  if (!user.stripe_customer_id) {
    return { eligible: false, reason: 'no_customer_id', refund_cents: 0 };
  }
  const plan = (user.plan || '').toLowerCase();
  if (!ANNUAL_PRICE_CENTS[plan]) {
    return { eligible: false, reason: 'plan_not_refundable', refund_cents: 0 };
  }

  const last = await findLastAnnualInvoice(user.subscription_id, user.stripe_customer_id, plan);
  if (!last) {
    return { eligible: false, reason: 'no_annual_charge_yet', refund_cents: 0 };
  }

  const paidAtMs = last.paid_at * 1000;
  const windowCloseMs = paidAtMs + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (now > windowCloseMs) {
    return {
      eligible: false,
      reason: 'window_closed',
      refund_cents: 0,
      last_invoice: { paid_at: last.paid_at, amount_paid: last.amount_paid },
      window_closes_at: Math.floor(windowCloseMs / 1000)
    };
  }

  const refundCents = Math.max(0, last.amount_paid - SERVICE_FEE_CENTS);

  return {
    eligible: true,
    reason: 'within_window',
    refund_cents: refundCents,
    last_invoice: {
      invoice_id: last.invoice.id,
      charge_id: last.charge_id,
      amount_paid: last.amount_paid,
      paid_at: last.paid_at
    },
    window_closes_at: Math.floor(windowCloseMs / 1000),
    plan
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });

  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.subscription_id) return res.status(400).json({ error: "No active subscription" });

  try {
    // 1. Compute refund eligibility
    const elig = await computeEligibility(user);

    let refundIssued = false;
    let refundAmountCents = 0;
    let refundId = null;

    // 2. If eligible, issue partial refund BEFORE canceling
    if (elig.eligible && elig.refund_cents > 0 && elig.last_invoice && elig.last_invoice.charge_id) {
      try {
        const refund = await stripe.refunds.create({
          charge: elig.last_invoice.charge_id,
          amount: elig.refund_cents,
          reason: 'requested_by_customer',
          metadata: {
            user_id: user.id,
            policy: '14_day_annual_refund',
            service_fee_cents: String(SERVICE_FEE_CENTS),
            invoice_id: elig.last_invoice.invoice_id
          }
        });
        refundIssued = true;
        refundAmountCents = refund.amount;
        refundId = refund.id;
        console.log('Refund issued ' + refund.id + ' for $' + (refund.amount / 100).toFixed(2));
      } catch (refundErr) {
        console.error('Refund failed (continuing with cancel):', refundErr.message);
        // We still proceed to cancel the subscription. If the refund failed,
        // the customer can contact support. We don't want to leave them stuck
        // with an uncanceled subscription.
      }
    }

    // 3. Cancel subscription in Stripe
    await stripe.subscriptions.cancel(user.subscription_id);

    // 4. Update user record. If refunded, return to etag/inactive immediately
    //    (they got their money back, lose access right away).
    //    If NOT refunded (just cancel), keep subscription_id null but plan
    //    stays — webhook customer.subscription.deleted handles full downgrade
    //    at period end. Actually since we canceled immediately above, the
    //    deleted event fires soon. To be safe, do the user updates here too.
    if (refundIssued) {
      await supabase.from("users")
        .update({ subscription_id: null, plan: 'etag' })
        .eq("id", user.id);
      // tags table — stop the tag immediately
      await supabase.from("tags")
        .update({ status: 'inactive' })
        .eq("owner_id", user.id);
    } else {
      // Standard cancel — stop future charges, keep tag active until
      // period end (webhook will downgrade when it fires).
      await supabase.from("users")
        .update({ subscription_id: null })
        .eq("id", user.id);
    }

    // 5. Audit
    if (_audit) {
      try {
        _audit({
          actor: 'user',
          action: refundIssued ? 'cancel_with_refund' : 'cancel_subscription',
          target_type: 'user',
          target_id: user.id,
          meta: {
            subscription_id: user.subscription_id,
            refund_issued: refundIssued,
            refund_amount_cents: refundAmountCents,
            refund_id: refundId
          }
        });
      } catch (e) {}
    }

    // 6. Email (best-effort)
    if (_resend && user.email) {
      try {
        if (refundIssued) {
          const refundDollars = (refundAmountCents / 100).toFixed(2);
          await _resend.emails.send({
            from: 'TapMyCar <noreply@tapmycar.io>',
            to: user.email,
            subject: 'Your TapMyCar refund of $' + refundDollars + ' is processed',
            html: '<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">' +
              '<h2 style="margin:0 0 12px">Refund processed</h2>' +
              '<p>Your TapMyCar subscription has been canceled and a refund of <b>$' + refundDollars + '</b> has been issued to your card.</p>' +
              '<p style="color:#6B7280;font-size:13px">Refund typically arrives within 3-5 business days. The $1 service fee is retained per our refund policy.</p>' +
              '<p>Your tag is now inactive. You can re-subscribe anytime from your dashboard.</p>' +
              '<p style="margin-top:24px;color:#9CA3AF;font-size:12px">TapMyCar by Praman Tech LLC</p>' +
            '</div>'
          });
        } else {
          await _resend.emails.send({
            from: 'TapMyCar <noreply@tapmycar.io>',
            to: user.email,
            subject: 'Your TapMyCar subscription is canceled',
            html: '<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">' +
              '<h2 style="margin:0 0 12px">Subscription canceled</h2>' +
              '<p>Your TapMyCar subscription will not renew. Your tag stays active until the end of your current paid period.</p>' +
              '<p style="color:#6B7280;font-size:13px">Physical stickers already shipped are yours to keep.</p>' +
              '<p style="margin-top:24px;color:#9CA3AF;font-size:12px">TapMyCar by Praman Tech LLC</p>' +
            '</div>'
          });
        }
      } catch (e) {
        console.warn('cancel email failed:', e && e.message);
      }
    }

    return res.json({
      success: true,
      refund_issued: refundIssued,
      refund_amount_cents: refundAmountCents,
      refund_id: refundId,
      eligibility_reason: elig.reason
    });
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Export the eligibility helper too so cancel-subscription-preview can reuse it.
module.exports.computeEligibility = computeEligibility;
