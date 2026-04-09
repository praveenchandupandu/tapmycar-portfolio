const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, phone, type } = req.body;

  // EMAIL OTP — used by signin.html and register.html
  if (type === 'email' || (!type && email)) {
    if (!email) return res.status(400).json({ error: 'Email required' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Delete ALL old OTPs for this email first — wait for it to complete
    const { error: delError } = await supabase
      .from('otp_codes')
      .delete()
      .eq('phone', email);

    if (delError) {
      console.error('Delete old OTPs error:', delError);
    }

    // Now insert new OTP
    const { error: insError } = await supabase
      .from('otp_codes')
      .insert({
        phone: email,
        code,
        used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });

    if (insError) {
      console.error('Insert OTP error:', insError);
      return res.status(500).json({ error: 'Failed to create verification code' });
    }

    try {
      await resend.emails.send({
        from: 'TapMyCar <noreply@tapmycar.io>',
        to: email,
        subject: 'Your TapMyCar verification code',
        html: `<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
          <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div>
          <div style="font-size:14px;color:#6B7280;margin-bottom:32px">Privacy for you. Safety for your car.</div>
          <div style="font-size:14px;color:#111;margin-bottom:16px">Your verification code is:</div>
          <div style="font-size:48px;font-weight:800;color:#FF6B00;letter-spacing:8px;margin-bottom:24px">${code}</div>
          <div style="font-size:12px;color:#9CA3AF">Expires in 10 minutes. Never share this code.</div>
          <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E5E7EB">
            <div style="font-size:11px;color:#9CA3AF">If you didn't request this code, you can safely ignore this email.</div>
          </div>
        </div>`
      });
      return res.json({ success: true });
    } catch(e) {
      console.error('Email send error:', e);
      return res.status(500).json({ error: 'Failed to send email' });
    }
  }

  // PHONE OTP — used by contact.html tag activation only
  if (type === 'phone' || (!type && phone)) {
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verifications.create({ to: phone, channel: 'sms' });
      return res.json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Email or phone required' });
};