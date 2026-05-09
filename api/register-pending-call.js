// TMC_PATCH9_CALL_FLOW
// TapMyCar - register-pending-call
// Stranger on contact.html taps Call. Browser POSTs the tag token here
// (no phone number - we will get the caller ID from Twilio when the call
// arrives at /api/inbound-call). We write a pending_calls row that the
// inbound-call webhook can match against to know which owner to ring.

const { createClient } = require('@supabase/supabase-js');
const { rateLimit, getClientIp } = require('./_rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'register-pending-call:ip:' + ip, max: 10, windowSeconds: 60 }
  ])) return;

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });

  const cleanToken = String(token).toUpperCase().trim();

  // Look up tag and verify it is callable (active + owner phone verified)
  const { data: tag } = await supabase
    .from('tags')
    .select('id, status, users(id, phone, phone_verified)')
    .eq('token', cleanToken)
    .single();

  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  if (tag.status !== 'active') {
    return res.status(403).json({ error: 'This tag is not yet active.' });
  }
  if (!tag.users || !tag.users.phone || !tag.users.phone_verified) {
    return res.status(403).json({
      error: 'This tag is not yet ready for calls. The owner needs to complete setup.'
    });
  }

  // Insert pending_calls row. inbound-call will look this up by recency.
  const { data: row, error: insErr } = await supabase
    .from('pending_calls')
    .insert({
      tag_id: tag.id,
      tag_token: cleanToken,
      owner_user_id: tag.users.id,
      owner_phone: tag.users.phone
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('register-pending-call insert error:', insErr.message);
    return res.status(500).json({ error: 'Could not register call. Please try again.' });
  }

  return res.json({ success: true, pending_id: row.id });
};
