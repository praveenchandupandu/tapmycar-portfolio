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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, code } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!code) return res.status(400).json({ error: 'code required' });

  const normalized = String(code).trim().toUpperCase();

  if (!CODE_FORMAT.test(normalized)) {
    return res.status(400).json({ error: 'Invalid code format. Expected TMC-PREM-XXXXXX.' });
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
