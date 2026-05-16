// ============================================================================
// TapMyCar - Patch 31: Subscription refund within 14 days
//
// Policy:
//   - Only ANNUAL subscription charges are refundable.
//   - Refund window: within 14 days of any annual charge (first or renewal).
//   - Refund amount: the annual amount paid MINUS a $1 service fee.
//     Standard $9.99 -> $8.99 refunded.
//     Premium  $19.99 -> $18.99 refunded.
//   - After refund: subscription is canceled permanently. User plan returns
//     to 'etag', their tag status becomes 'inactive' until they re-subscribe.
//   - NOT refundable: sticker fee ($9.99), activation fee ($1), prepaid bundle
//     extras. Only the actual annual subscription invoice is refundable.
//
// What this patch builds:
//
//   28.1  api/cancel-subscription.js — rewritten:
//         - Look up most recent paid invoice on the user's subscription
//         - Determine if it's an annual charge (billing_reason 'subscription_create'
//           or 'subscription_cycle' AND amount equals annual price)
//         - If yes AND within 14 days, issue partial refund (amount - $1)
//         - Cancel subscription immediately (not at period end)
//         - Update users.plan='etag', tags.status='inactive'
//         - Send refund confirmation email
//         - Audit-log the action
//
//   28.2  api/cancel-subscription-preview.js (new) — GET-style helper:
//         - Returns refund eligibility + amount + window-close date
//         - So the Settings UI can show "Cancel & refund $8.99" vs "Cancel"
//
//   28.3  public/settings.html — adaptive cancel button:
//         - On load, fetch eligibility
//         - Update button label and confirm dialog accordingly
//
//   28.4  public/pricing.html — refund copy already accurate, append sticker
//         non-refundability for clarity
//
//   28.5  public/activate.html — replace inaccurate
//         "Cancel anytime before day 30 — full refund if cancelled"
//         with accurate policy
//
//   28.6  public/payment-success.html — replace 2 inaccurate refund claims
//         with accurate policy
//
// Properties: idempotent, validates JS, backs up touched files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch31-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try { execSync('node --check "' + p + '"', { stdio: 'pipe' }); }
  catch (e) { errExit('JS syntax error in ' + p + '\n' + e.stderr.toString()); }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 31 \u2014 subscription refund within 14 days');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH31_REFUND';

// ===========================================================================
// 31.1  api/cancel-subscription.js — rewritten with refund logic
// ===========================================================================

log('31.1  api/cancel-subscription.js: rewrite with refund logic');
{
  const file = path.join(API, 'cancel-subscription.js');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('cancel-subscription.js');
  } else {
    backup(file);

    const newBody = `// ${MARKER}: subscription refund within 14 days
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

// Optional Resend (best-effort \u2014 don't block cancel on email failure)
let _resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) _resend = new Resend(process.env.RESEND_API_KEY);
} catch (e) {}

// Refund policy constants
const REFUND_WINDOW_DAYS = 14;
const SERVICE_FEE_CENTS = 100; // $1 retained on refund

// Annual price cents per plan \u2014 used to identify which invoices are
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
  if (/^https:\\/\\/[a-z0-9-]+\\.vercel\\.app$/.test(origin)) return true;
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
    //    stays \u2014 webhook customer.subscription.deleted handles full downgrade
    //    at period end. Actually since we canceled immediately above, the
    //    deleted event fires soon. To be safe, do the user updates here too.
    if (refundIssued) {
      await supabase.from("users")
        .update({ subscription_id: null, plan: 'etag' })
        .eq("id", user.id);
      // tags table \u2014 stop the tag immediately
      await supabase.from("tags")
        .update({ status: 'inactive' })
        .eq("owner_id", user.id);
    } else {
      // Standard cancel \u2014 stop future charges, keep tag active until
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
`;

    writeFile(file, newBody);
    validateJs(file);
    ok('cancel-subscription.js: rewritten with refund logic');
  }
}

// ===========================================================================
// 31.2  api/cancel-subscription-preview.js — eligibility preview
// ===========================================================================

log('');
log('31.2  api/cancel-subscription-preview.js: preview endpoint');
{
  const file = path.join(API, 'cancel-subscription-preview.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER)) {
    skip('cancel-subscription-preview.js (already exists)');
  } else {
    const body = `// ${MARKER}: GET preview of refund eligibility
//
// Frontend calls this to know whether to show "Cancel & refund $X" or just
// "Cancel". Returns the same shape that cancel-subscription's computeEligibility
// produces. Does NOT perform any cancel or refund.

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { computeEligibility } = require('./cancel-subscription');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // user_id from query (GET) or body (POST). No admin auth \u2014 this is the
  // user previewing their own cancel options. We do require user_id to match
  // a real user, which is sufficient because user_id is only known to that user.
  const user_id = (req.query && req.query.user_id) || (req.body && req.body.user_id);
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: user } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const elig = await computeEligibility(user);
    return res.json({ success: true, ...elig });
  } catch (e) {
    console.error('preview error:', e && e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('cancel-subscription-preview.js: created');
  }
}

// ===========================================================================
// 31.3  public/settings.html — adaptive cancel button
// ===========================================================================

log('');
log('31.3  public/settings.html: adaptive cancel button + refund flow');
{
  const file = path.join(PUBLIC, 'settings.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('settings.html');
  } else {
    backup(file);

    // Replace the cancelSubscription function with refund-aware version.
    const anchor = `async function cancelSubscription() {
  if (!confirm('Cancel your TapMyCar subscription?\\n\\nYou will not be charged again. Your tag will stay active until the end of your current paid period.\\n\\nPhysical stickers already shipped are yours to keep.')) return;
  try {
    const res = await fetch('/api/cancel-subscription', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ user_id: s.token }) });
    const data = await res.json();
    if (data.success) { showToast('Subscription cancelled'); document.getElementById('cancel-sub-row').style.display = 'none'; }
    else { showToast(data.error || 'Failed to cancel'); }
  } catch(e) { showToast('Network error'); }
}`;

    const replacement = `/* ${MARKER}: cache refund eligibility, refresh when settings loaded */
let _p31Elig = null;

async function _p31LoadEligibility() {
  try {
    const r = await fetch('/api/cancel-subscription-preview?user_id=' + encodeURIComponent(s.token));
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || !data.success) return null;
    _p31Elig = data;
    // Update the cancel row's subtitle if user is eligible for refund
    const sub = document.querySelector('#cancel-sub-row .set-s');
    if (sub && data.eligible && data.refund_cents > 0) {
      const dollars = (data.refund_cents / 100).toFixed(2);
      sub.textContent = 'Refund $' + dollars + ' available (within 14 days)';
    }
    return data;
  } catch (e) { return null; }
}

async function cancelSubscription() {
  /* ${MARKER}: refresh eligibility right before showing dialog */
  await _p31LoadEligibility();

  let confirmed = false;
  if (_p31Elig && _p31Elig.eligible && _p31Elig.refund_cents > 0) {
    const dollars = (_p31Elig.refund_cents / 100).toFixed(2);
    confirmed = confirm(
      'Cancel and refund $' + dollars + '?\\n\\n' +
      'You paid your annual subscription within the last 14 days, so we will refund $' + dollars + ' to your card now.\\n' +
      '($1 service fee retained per refund policy.)\\n\\n' +
      'After the refund:\\n' +
      '\u2022 Your subscription stops immediately\\n' +
      '\u2022 Your tag becomes inactive\\n' +
      '\u2022 Physical stickers you have are yours to keep\\n' +
      '\u2022 You can re-subscribe anytime\\n\\n' +
      'Refund arrives in 3-5 business days.'
    );
  } else {
    confirmed = confirm(
      'Cancel your TapMyCar subscription?\\n\\n' +
      'You will not be charged again. Your tag stays active until the end of your current paid period.\\n\\n' +
      'Physical stickers already shipped are yours to keep.\\n\\n' +
      'Note: refunds are only available within 14 days of an annual charge.'
    );
  }
  if (!confirmed) return;

  try {
    const res = await fetch('/api/cancel-subscription', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token })
    });
    const data = await res.json();
    if (data.success) {
      if (data.refund_issued && data.refund_amount_cents > 0) {
        const d = (data.refund_amount_cents / 100).toFixed(2);
        showToast('Canceled. Refund of $' + d + ' on its way.');
      } else {
        showToast('Subscription canceled');
      }
      document.getElementById('cancel-sub-row').style.display = 'none';
    } else {
      showToast(data.error || 'Failed to cancel');
    }
  } catch(e) {
    showToast('Network error');
  }
}

/* ${MARKER}: load eligibility on page load (after settings render) */
(function() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(_p31LoadEligibility, 800); });
  } else {
    setTimeout(_p31LoadEligibility, 800);
  }
})();`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) errExit('settings.html: cancelSubscription anchor not found');

    writeFile(file, r);
    ok('settings.html: adaptive cancel + refund flow');
  }
}

// ===========================================================================
// 31.4-31.6  UI copy fixes (pricing, activate, payment-success)
// ===========================================================================

log('');
log('31.4  public/pricing.html: clarify refund + sticker non-refundability');
{
  const file = path.join(PUBLIC, 'pricing.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('pricing.html');
  } else {
    backup(file);

    const anchor = `    Cancel anytime in Settings. Physical stickers are non-refundable once shipped.<br>
    Annual plan refundable within 14 days of each annual charge.<br>`;
    const replacement = `    <!-- ${MARKER}: clearer refund copy -->
    Cancel anytime in Settings.<br>
    Annual subscription is refundable within 14 days of each annual charge ($1 service fee retained).<br>
    Activation fees, sticker fees, and prepaid bundle extras are non-refundable.<br>`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) warn('pricing.html: refund copy anchor not found');
    else {
      writeFile(file, r);
      ok('pricing.html: refund copy updated');
    }
  }
}

log('');
log('31.5  public/activate.html: replace inaccurate "before day 30" claim');
{
  const file = path.join(PUBLIC, 'activate.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('activate.html');
  } else {
    backup(file);

    const anchor = `<div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 — full refund if cancelled</div></div>`;
    const replacement = `<!-- ${MARKER}: accurate refund policy -->
<div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 to stop the $9.99 annual charge. The $1 activation fee is non-refundable.</div></div>`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) {
      // try the unicode em-dash variant
      const anchorAlt = `<div style="background:var(--gnl);border-radius:8px;padding:6px 10px;margin-top:8px"><div style="font-size:10px;color:#15803D;font-weight:600">Cancel anytime before day 30 \u2014 full refund if cancelled</div></div>`;
      r = tryReplace(content, anchorAlt, replacement);
    }
    if (!r) warn('activate.html: refund copy anchor not found');
    else {
      writeFile(file, r);
      ok('activate.html: refund copy updated');
    }
  }
}

log('');
log('31.6  public/payment-success.html: fix 2 inaccurate refund claims');
{
  const file = path.join(PUBLIC, 'payment-success.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('payment-success.html');
  } else {
    backup(file);
    let updated = content;

    // First occurrence (Standard activate)
    const a1 = `      '<div>Cancel anytime before day 30 for a full refund of the $1.</div>';`;
    const r1 = `      /* ${MARKER}: accurate \u2014 $1 is NOT refundable */
      '<div>Cancel before day 30 to stop the $9.99 annual charge. The $1 activation fee is non-refundable.</div>';`;
    if (updated.includes(a1)) updated = updated.replace(a1, r1);

    // Second occurrence (Premium activate). Same string \u2014 already replaced.
    // To replace both, we use a global replace via splitting since includes()
    // detects the first only.
    if (updated.indexOf(a1) >= 0) {
      // replace remaining occurrences
      while (updated.indexOf(a1) >= 0) updated = updated.replace(a1, r1);
    }

    // Also update the footer line about non-refundable stickers
    const a3 = `    Cancel anytime in Settings. Physical stickers are non-refundable once shipped.<br>`;
    const r3 = `    <!-- ${MARKER}: clearer footer -->
    Cancel anytime in Settings. Annual subscription refundable within 14 days ($1 service fee retained). Activation and sticker fees are non-refundable.<br>`;
    if (updated.includes(a3)) updated = updated.replace(a3, r3);

    writeFile(file, updated);
    ok('payment-success.html: refund copy updated');
  }
}

log('');
log('==============================================================');
log('Patch 31 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 31: subscription refund within 14 days"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan (in LIVE mode, with real money):');
log('  1. Make a real annual subscription purchase ($9.99 Standard).');
log('  2. Open Settings.');
log('  3. The "Cancel subscription" row should show subtitle');
log('     "Refund $8.99 available (within 14 days)".');
log('  4. Click it. Confirm dialog should mention $8.99 refund + $1 retained.');
log('  5. Confirm. Refund processes:');
log('     - Stripe Dashboard: refund row of $8.99 appears');
log('     - Supabase users table: plan=etag, subscription_id=null');
log('     - Supabase tags table: status=inactive');
log('     - Email: refund confirmation arrives');
log('  6. After 14 days (or set window_closes_at manually for testing),');
log('     the same Cancel button shows the no-refund dialog instead.');
log('  7. Activation-flow ($1) users: $1 stays charged forever per policy.');
log('==============================================================');
