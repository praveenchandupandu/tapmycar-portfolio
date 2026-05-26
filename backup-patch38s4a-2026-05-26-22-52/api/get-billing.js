// TMC_PATCH36C_BILLING
// Plan & Billing data for a single user.
// GET /api/get-billing?user_id=...

const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { data: user } = await supabase
      .from('users').select('*').eq('id', user_id).single();
    if (!user) return res.status(404).json({ error: 'User not found' });

    /* payment history */
    const { data: orders } = await supabase
      .from('orders')
      .select('plan, amount, order_status, status, sticker_count, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    /* TMC_PATCH36CFIX_GIFT_AWARE: detect an expired gift tag so the page can show the
       real gift plan instead of "eTag (Free)". */
    let giftExpired = null;
    try {
      const { data: bTags } = await supabase
        .from('tags')
        .select('gift_expired, gift_plan, is_gift')
        .eq('owner_id', user_id);
      if (bTags && bTags.length) {
        for (let i = 0; i < bTags.length; i++) {
          if (bTags[i] && bTags[i].gift_expired === true) {
            giftExpired = { plan: bTags[i].gift_plan || 'standard' };
            break;
          }
        }
      }
    } catch (gtErr) {
      console.error('TMC_PATCH36CFIX_GIFT_AWARE: gift tag lookup failed:', gtErr && gtErr.message);
    }

    /* premium family codes (premium users only) */
    let premiumCodes = [];
    if (user.plan === 'premium') {
      const { data: codes } = await supabase
        .from('premium_codes')
        .select('code, redeemed_by_user_id, redeemed_at, revoked_at')
        .eq('buyer_user_id', user_id)
        .is('revoked_at', null);
      premiumCodes = codes || [];
    }

    /* live renewal date + next amount from Stripe */
    let renewal = null;
    let nextAmountCents = null;
    let subStatus = null;
    if (user.subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.subscription_id);
        if (sub) {
          subStatus = sub.status;
          if (sub.current_period_end) {
            renewal = new Date(sub.current_period_end * 1000).toISOString();
          }
          if (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) {
            nextAmountCents = sub.items.data[0].price.unit_amount || null;
          }
        }
      } catch (subErr) {
        console.error('TMC_PATCH36C_BILLING: subscription retrieve failed:', subErr && subErr.message);
      }
    }

    /* if a gift trial is active, surface its expiry as the renewal-equivalent */
    let giftExpiresAt = user.gift_plan_expires_at || null;

    return res.json({
      plan: user.plan || 'etag',
      subStatus,
      renewal,
      giftExpiresAt,
      giftExpired,
      nextAmountCents,
      orders: orders || [],
      premiumCodes
    });
  } catch (e) {
    console.error('TMC_PATCH36C_BILLING: fatal', e && e.message);
    return res.status(500).json({ error: 'Could not load billing' });
  }
};
