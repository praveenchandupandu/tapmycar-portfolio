// TMC_PATCH4_PHONE_VERIFY_HELPER
// TapMyCar - start phone verification
// POST { user_id } -> sends SMS via Twilio Verify to user.phone
//
// On success: { success: true }
// On failure: { error: '...' } with appropriate status code

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

  // Rate limits
  const ip = getClientIp(req);
  const { user_id } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!UUID_RE.test(String(user_id))) return res.status(400).json({ error: 'Invalid user_id format' });

  if (!await rateLimit(req, res, [
    { key: 'start-phone-verify:ip:' + ip, max: 5, windowSeconds: 3600 },
    { key: 'start-phone-verify:user:' + user_id, max: 3, windowSeconds: 3600 }
  ])) return;

  // Look up user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, phone, phone_verified')
    .eq('id', user_id)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });
  if (!user.phone) return res.status(400).json({ error: 'No phone number on this account. Please update your profile first.' });

  // If already verified, short-circuit
  if (user.phone_verified) {
    return res.json({ success: true, already_verified: true });
  }

  // Send via Twilio Verify
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: user.phone, channel: 'sms' });
    return res.json({ success: true });
  } catch (e) {
    console.error('Twilio Verify start error:', e && e.message);
    // Don't leak Twilio internals to user
    return res.status(500).json({ error: 'Could not send verification code. Please try again in a moment.' });
  }
};
