const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
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

  try {
    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({
        to: formatted,
        channel: 'sms'
      });

    console.log('OTP sent to:', formatted);
    res.json({ success: true });
  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
