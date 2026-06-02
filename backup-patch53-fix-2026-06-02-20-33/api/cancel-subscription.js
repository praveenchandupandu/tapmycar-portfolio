// TMC_PATCH31_REFUND: subscription refund within 14 days
//
// Policy: only annual subscription charges are refundable, within 14 days
// of the charge. Refund = amount_paid - $1 service fee. After refund, sub
// is canceled and user returns to 'etag' plan.

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { resolveUser, recordTokenType } = require('./_auth'); /* TMC_PATCH38S4 */

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

  /* TMC_PATCH38S4: identify the caller from a signed session token or a
     legacy UUID. resolveUser() accepts both, so no logged-in user is
     locked out; the resolved id replaces any user_id the request claimed
     (IDOR fix). viaLegacy records which token type, for the counter. */
  const _tmcAuth = resolveUser(req);
  if (!_tmcAuth) return res.status(401).json({ error: 'Authentication required' });
  const user_id = _tmcAuth.userId;
  await recordTokenType(supabase, user_id, _tmcAuth.viaLegacy);

  const { data: user } = await supabase.from("users").select("*").eq("id", user_id).single();
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.subscription_id) return res.status(400).json({ error: "No active subscription" });

  /* TMC_PATCH53: advisory lock against rapid double-clicks. If another
     cancel for this user is in progress within the last 60 seconds, refuse.
     We set the timestamp on success, clear it at the end via finally. */
  const lockNow = new Date();
  const lockExpiry = new Date(lockNow.getTime() - 60 * 1000);
  const { data: lockCheck } = await supabase.from('users')
    .select('refund_in_progress_at')
    .eq('id', user.id).single();
  if (lockCheck && lockCheck.refund_in_progress_at && new Date(lockCheck.refund_in_progress_at) > lockExpiry) {
    return res.status(409).json({ error: 'A cancellation is already in progress. Please wait a moment.' });
  }
  await supabase.from('users').update({ refund_in_progress_at: lockNow.toISOString() }).eq('id', user.id);

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
        /* TMC_PATCH53: record the failure on the most recent renewal/direct
           order so admin can see it. Then send the user an honest email so
           they know support will contact them. We still cancel the sub. */
        console.error('Refund failed:', refundErr && refundErr.message);
        try {
          const { data: lastOrder } = await supabase
            .from('orders')
            .select('id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (lastOrder && lastOrder.id) {
            await supabase.from('orders').update({
              refund_failed_at: new Date().toISOString(),
              refund_error_message: (refundErr && refundErr.message) || 'unknown'
            }).eq('id', lastOrder.id);
          }
        } catch (e) { console.warn('p53: could not flag order:', e && e.message); }

        /* User-facing email about the refund failure (not the cancellation). */
        try {
          if (user.email) {
            const { Resend } = require('resend');
            const _r = new Resend(process.env.RESEND_API_KEY);
            await _r.emails.send({
              from: 'TapMyCar <noreply@tapmycar.io>',
              to: user.email,
              subject: 'Your TapMyCar refund needs attention',
              html: ''+
                '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
                  '<div style="font-size:22px;font-weight:800;padding:12px 4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
                  '<div style="background:#fff;border:1px solid #FED7AA;border-left:4px solid #FF6B00;border-radius:14px;padding:26px 24px">' +
                    '<h1 style="font-size:18px;font-weight:800;margin:0 0 12px;color:#C2410C">We need to look at your refund</h1>' +
                    '<p style="font-size:14px;line-height:1.65;color:#374151">Your subscription has been canceled, but our automatic refund attempt did not complete. This is unusual and means our team needs to step in manually.</p>' +
                    '<p style="font-size:14px;line-height:1.65;color:#374151">A member of our team will reach out within one business day to confirm and process your refund. No action needed from you.</p>' +
                    '<p style="font-size:13px;line-height:1.6;color:#6B7280">If you have not heard from us within 24 hours, email <a href="mailto:support@tapmycar.io" style="color:#FF6B00">support@tapmycar.io</a>.</p>' +
                  '</div>' +
                  '<div style="font-size:11px;color:#9CA3AF;padding:16px 6px;line-height:1.6">Praman Tech LLC, Connecticut, USA</div>' +
                '</div>'
            });
          }
        } catch (e) { console.warn('p53: could not send refund-fail email:', e && e.message); }
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
      /* TMC_PATCH45B: revoke this user's matching referral row if still
         in 'pending' (i.e. inside the 14-day hold). The 14-day hold means
         the referrer cannot have spent the credit yet, so no claw-back
         is needed. We only act on 'pending' rows to be defensive. */
      try {
        await supabase.from('referrals').update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoke_reason: 'referred_user_refunded'
        }).eq('referred_user_id', user.id).eq('status', 'pending');
      } catch (e) {
        console.warn('p45b: referral revoke failed (non-fatal):', e && e.message);
      }
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

    /* TMC_PATCH53: clear the lock on success. */
    try { await supabase.from('users').update({ refund_in_progress_at: null }).eq('id', user.id); }
    catch (e) { console.warn('p53: lock clear failed:', e && e.message); }
    return res.json({
      success: true,
      refund_issued: refundIssued,
      refund_amount_cents: refundAmountCents,
      refund_id: refundId,
      eligibility_reason: elig.reason
    });
  } catch (err) {
    /* TMC_PATCH53: clear the lock on error too, so retry is possible. */
    try { await supabase.from('users').update({ refund_in_progress_at: null }).eq('id', user.id); }
    catch (e) { console.warn('p53: lock clear failed:', e && e.message); }
    console.error("Cancel subscription error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Export the eligibility helper too so cancel-subscription-preview can reuse it.
module.exports.computeEligibility = computeEligibility;
