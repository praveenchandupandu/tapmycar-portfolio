// TMC_PATCH4_PHONE_VERIFY_HELPER
// TapMyCar - confirm phone verification
// POST { user_id, code } -> checks via Twilio Verify, marks phone_verified

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { rateLimit, getClientIp } = require('./_rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const { user_id, code } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!UUID_RE.test(String(user_id))) return res.status(400).json({ error: 'Invalid user_id format' });
  if (!/^\d{4,8}$/.test(String(code).trim())) return res.status(400).json({ error: 'Invalid code format' });

  if (!await rateLimit(req, res, [
    { key: 'confirm-phone-verify:ip:' + ip, max: 20, windowSeconds: 3600 },
    { key: 'confirm-phone-verify:user:' + user_id, max: 10, windowSeconds: 3600 }
  ])) return;

  // Look up user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, phone, phone_verified')
    .eq('id', user_id)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });
  if (!user.phone) return res.status(400).json({ error: 'No phone number on this account.' });

  // Already verified — short-circuit
  if (user.phone_verified) {
    return res.json({ success: true, already_verified: true });
  }

  // Check via Twilio Verify
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: user.phone, code: String(code).trim() });
    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
    }
  } catch (e) {
    console.error('Twilio Verify check error:', e && e.message);
    return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
  }

  // Mark verified (account-level flag, informational)
  const { error: updErr } = await supabase
    .from('users')
    .update({ phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq('id', user_id);

  if (updErr) {
    console.error('phone_verified update error:', updErr.message);
    return res.status(500).json({ error: 'Verification succeeded but database update failed. Please try again.' });
  }

  // TMC_PATCH5_ACTIVATION_SESSION
  // Issue a one-shot activation session token. The activation API
  // (get-tag.js POST claim) requires this token to flip a tag to active.
  // The token is consumable: used=true after activation, expires after
  // 5 minutes if unused. This enforces "every activation needs fresh SMS".
  let activation_session_id = null;
  try {
    const { data: sessionRow, error: sessionErr } = await supabase
      .from('activation_sessions')
      .insert({ user_id })
      .select('id')
      .single();
    if (sessionErr) {
      console.error('activation_sessions insert error:', sessionErr.message);
      // Don't fail the verification — but log loudly. Frontend will get
      // null session_id and show a clear error to retry.
    } else {
      activation_session_id = sessionRow.id;
    }
  } catch (e) {
    console.error('activation_sessions insert exception:', e && e.message);
  }

  return res.json({
    success: true,
    activation_session_id
  });
};
