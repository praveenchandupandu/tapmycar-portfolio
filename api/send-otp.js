const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, phone, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  // Clean phone number
  const cleaned = phone.replace(/\D/g, '');
  const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  // Twilio Lookup — verify phone is real — costs $0.005
  try {
    const lookup = await twilioClient.lookups.v2
      .phoneNumbers(formatted)
      .fetch({ fields: 'line_type_intelligence' });

    if (!lookup.valid) {
      return res.status(400).json({ error: 'Invalid phone number. Please enter a valid US phone number.' });
    }
  } catch (err) {
    console.error('Lookup error:', err.message);
    return res.status(400).json({ error: 'Could not verify phone number. Please check and try again.' });
  }

  // Generate 6 digit OTP code
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Delete old codes for this email
  await supabase
    .from('otp_codes')
    .delete()
    .eq('phone', email);

  // Save new code
  const { error: dbError } = await supabase
    .from('otp_codes')
    .insert({
      phone: email,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

  if (dbError) {
    console.error('DB error:', dbError);
    return res.status(500).json({ error: 'Failed to save code' });
  }

  // Send email via Resend
  try {
    await resend.emails.send({
      from: 'TapMyCar <noreply@tapmycar.io>',
      to: email,
      subject: 'Your TapMyCar verification code',
      html: `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#fff">
          <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:4px">
            TapMyCar<span style="color:#FF6B00">.</span>
          </div>
          <div style="font-size:13px;color:#6B7280;margin-bottom:32px">
            Privacy-first vehicle contact
          </div>
          <div style="font-size:15px;color:#111;margin-bottom:8px;font-weight:600">
            Your verification code
          </div>
          <div style="font-size:13px;color:#6B7280;margin-bottom:24px">
            Enter this code in the TapMyCar app to verify your account.
          </div>
          <div style="background:#FFF3EC;border:2px solid #FF6B00;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px">
            <div style="font-size:48px;font-weight:800;color:#FF6B00;letter-spacing:10px">
              ${code}
            </div>
          </div>
          <div style="font-size:12px;color:#9CA3AF;margin-bottom:8px">
            This code expires in 10 minutes.
          </div>
          <div style="font-size:12px;color:#9CA3AF;margin-bottom:32px">
            If you did not request this code, please ignore this email.
          </div>
          <div style="border-top:1px solid #E5E7EB;padding-top:20px">
            <div style="font-size:11px;color:#D1D5DB">
              © 2026 Praman Tech LLC · New Britain, CT · 
              <a href="https://tapmycar.io" style="color:#FF6B00;text-decoration:none">tapmycar.io</a>
            </div>
          </div>
        </div>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Resend error:', err.message);
    res.status(500).json({ error: err.message });
  }
};