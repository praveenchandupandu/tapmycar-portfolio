const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const twil = twilio(
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

  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  const cleaned = phone.replace(/\D/g, '');
  const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await supabase
    .from('otp_codes')
    .delete()
    .eq('phone', formatted);

  const { error } = await supabase
    .from('otp_codes')
    .insert({ phone: formatted, code });

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: 'Failed to save OTP' });
  }

  try {
    await twil.messages.create({
      body: `Your TapMyCar code is: ${code}. Valid for 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formatted
    });
    console.log('OTP sent to:', formatted);
    res.json({ success: true });
  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ error: err.message });
  }
};