const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, caller_number, emergency_phone, owner_name } = req.body;

  if (!token || !caller_number) {
    return res.status(400).json({ error: 'token and caller_number required' });
  }

  // Clean caller number
  const cleaned = caller_number.replace(/\D/g, '');
  const callerFormatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  // Get tag and owner from database
  const { data: tag, error } = await supabase
    .from('tags')
    .select('*, users(phone, name)')
    .eq('token', token)
    .single();

  if (error || !tag) {
    return res.status(404).json({ error: 'Tag not found' });
  }

  if (tag.status === 'inactive') {
    return res.status(400).json({ error: 'Tag not activated' });
  }

  const ownerPhone = emergency_phone || tag.users.phone;
  const friendName = owner_name || tag.users.name || "your friend";
  const isEmergency = !!emergency_phone;

  try {
    // Create Twilio call â€” caller hears ringing, owner gets called
    const call = await client.calls.create({
      to: ownerPhone,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: isEmergency ? `<Response><Gather input="dtmf" timeout="10" numDigits="1" action="https://${req.headers.host}/api/voice-action" method="POST"><Say voice="alice">Hello. Someone scanned your friend ${friendName}s TapMyCar tag but was unable to reach them. We are calling you as the emergency contact. Press 1 to send an automated message. Press 2 to speak with the caller directly.</Say></Gather><Say voice="alice">No input received. Goodbye.</Say></Response>` : `<Response><Say voice="alice">You have an incoming masked call from a TapMyCar scan. Connecting now.</Say><Dial callerId="${process.env.TWILIO_PHONE_NUMBER}"><Number>${callerFormatted}</Number></Dial></Response>`
    });

    // Log the scan as a call
    await supabase
      .from('scan_logs')
      .insert({ tag_id: tag.id, action: 'call' });

    res.json({ success: true, call_sid: call.sid });
  } catch (err) {
    console.error('Call error:', err.message);
    res.status(500).json({ error: err.message });
  }
};



