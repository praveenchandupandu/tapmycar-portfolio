const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * TapMyCar — Premium Gift Code Redemption
 * ═══════════════════════════════════════════════════════════════
 * POST /api/redeem-code
 * Body: { user_id, code }
 *
 * Validates a TMC-PREM-XXXXXX code and links the redeeming user
 * to the original buyer (parent_user_id) so they get Premium plan
 * and the cancel-cascade rule works (main buyer cancels = family
 * tags disabled).
 */

const CODE_FORMAT = /^TMC-PREM-[A-HJ-NP-Z2-9]{6}$/;
const REFERRAL_FORMAT = /^TMC-[A-HJ-NP-Z2-9]{6}$/; /* TMC_PATCH43_REFERRALS */
const { rateLimit, getClientIp } = require('./_rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TMC_PATCH3_RATE_LIMIT
  const _tmcIp = getClientIp(req);
  const _tmcRateRules = [
    { key: 'redeem-code:ip:' + _tmcIp, max: 10, windowSeconds: 60 }
  ];
  if (!await rateLimit(req, res, _tmcRateRules)) return;


  const { user_id, code } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!code) return res.status(400).json({ error: 'code required' });

  // TMC_PATCH2_UUID_VALIDATE
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(user_id))) {
    return res.status(400).json({ error: 'Invalid user_id format' });
  }

  const normalized = String(code).trim().toUpperCase();

  /* TMC_PATCH43_REFERRALS: handle TMC-XXXXXX referral codes. Premium
     codes are TMC-PREM-XXXXXX (longer). The regex anchors guarantee the
     two formats can't both match. Referral path returns directly here;
     premium path continues unchanged below. */
  if (REFERRAL_FORMAT.test(normalized)) {
    const { data: referrer, error: refLookupErr } = await supabase
      .from('users')
      .select('id, name')
      .eq('referral_code', normalized)
      .maybeSingle();
    if (refLookupErr) {
      console.error('referral lookup error:', refLookupErr.message);
      return res.status(500).json({ error: 'Lookup failed' });
    }
    if (!referrer) {
      return res.status(404).json({ error: "We couldn't find that referral code. Double-check the spelling." });
    }
    if (referrer.id === user_id) {
      return res.status(400).json({ error: "You can't use your own referral code." });
    }
    /* Check the user's current referred_by:
         - same code already on file -> idempotent success
         - different code on file    -> reject (one referrer per user) */
    const { data: u } = await supabase
      .from('users')
      .select('referred_by')
      .eq('id', user_id)
      .single();
    if (u && u.referred_by) {
      if (u.referred_by === normalized) {
        return res.status(200).json({
          success: true,
          type: 'referral',
          alreadyRedeemed: true,
          referrer_name: referrer.name || 'your friend'
        });
      }
      return res.status(400).json({ error: "You've already used a referral code on this account." });
    }
    /* Set referred_by so stripe-webhook credits the referrer when this
       user buys a paid plan. This is the missing link bug 2 fixes. */
    const { error: updErr } = await supabase
      .from('users')
      .update({ referred_by: normalized })
      .eq('id', user_id);
    if (updErr) {
      console.error('referral set failed:', updErr.message);
      return res.status(500).json({ error: 'Could not apply the referral code right now.' });
    }
    return res.status(200).json({
      success: true,
      type: 'referral',
      referrer_name: referrer.name || 'your friend'
    });
  }

  if (!CODE_FORMAT.test(normalized)) {
    return res.status(400).json({ error: 'Invalid code format. Expected TMC-PREM-XXXXXX or TMC-XXXXXX.' });
  }

  // ─── Look up the code ────────────────────────────────────────
  const { data: codeRow, error: lookupErr } = await supabase
    .from('premium_codes')
    .select('*')
    .eq('code', normalized)
    .maybeSingle();

  if (lookupErr) {
    console.error('redeem-code lookup error:', lookupErr.message);
    return res.status(500).json({ error: 'Lookup failed' });
  }

  if (!codeRow) {
    return res.status(404).json({ error: "We couldn't find that code. Double-check the spelling." });
  }

  if (codeRow.revoked_at) {
    return res.status(400).json({ error: 'This code has been revoked.' });
  }

  if (codeRow.redeemed_at && codeRow.redeemed_by_user_id) {
    if (codeRow.redeemed_by_user_id === user_id) {
      return res.status(200).json({ success: true, alreadyRedeemed: true, message: "You've already redeemed this code." });
    }
    return res.status(400).json({ error: 'This code has already been redeemed.' });
  }

  // ─── Don't allow buyer to redeem their own non-self-assigned code ──
  if (codeRow.buyer_user_id === user_id) {
    return res.status(400).json({ error: "You can't redeem your own gift codes — those are for family." });
  }

  // ─── Check the redeemer hasn't already redeemed a different code ──
  const { data: existing } = await supabase
    .from('premium_codes')
    .select('code')
    .eq('redeemed_by_user_id', user_id)
    .is('revoked_at', null)
    .maybeSingle();

  if (existing) {
    return res.status(400).json({ error: `You've already redeemed code ${existing.code}.` });
  }

  // ─── Mark code as redeemed ───────────────────────────────────
  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('premium_codes')
    .update({
      redeemed_by_user_id: user_id,
      redeemed_at: nowIso
    })
    .eq('id', codeRow.id);

  if (updErr) {
    console.error('redeem-code update error:', updErr.message);
    return res.status(500).json({ error: 'Could not redeem the code right now.' });
  }

  // ─── Link the redeeming user to the buyer + upgrade to Premium ──
  await supabase
    .from('users')
    .update({
      parent_user_id: codeRow.buyer_user_id,
      redeemed_code: normalized,
      plan: 'premium'
    })
    .eq('id', user_id);

  // ─── If the redeemer has any active tag, set its plan to premium ──
  await supabase
    .from('tags')
    .update({ plan: 'premium' })
    .eq('owner_id', user_id);

  console.log(`✓ Code ${normalized} redeemed by user ${user_id} (buyer: ${codeRow.buyer_user_id})`);

  return res.json({
    success: true,
    plan: 'premium',
    parent_user_id: codeRow.buyer_user_id,
    message: "Welcome to Premium! Your account is now linked under your family's plan."
  });
};
