const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, phone, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Generate 6 digit code
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
        <div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px">
          <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">
            TapMyCar<span style="color:#FF6B00">.</span>
          </div>
          <div style="font-size:14px;color:#6B7280;margin-bottom:32px">
            Privacy-first vehicle contact
          </div>
          <div style="font-size:14px;color:#111;margin-bottom:24px">
            Your verification code is:
          </div>
          <div style="font-size:48px;font-weight:800;color:#FF6B00;letter-spacing:8px;margin-bottom:24px">
            ${code}
          </div>
          <div style="font-size:12px;color:#9CA3AF;margin-bottom:32px">
            This code expires in 10 minutes. Do not share it with anyone.
          </div>
          <div style="font-size:11px;color:#D1D5DB">
            © 2026 Praman Tech LLC · New Britain, CT
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