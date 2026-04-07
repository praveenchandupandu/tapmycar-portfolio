const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, phone, code, name, token, type } = req.body;

  // PHONE OTP — Twilio Verify (used for tag activation)
  if (type === 'phone') {
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verificationChecks.create({ to: phone, code });
      if (check.status !== 'approved') return res.status(400).json({ error: 'Invalid or expired code' });
    } catch(e) { return res.status(400).json({ error: 'Invalid or expired code' }); }

    // Find or create user
    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
    if (!user) {
      const { data: newUser } = await supabase.from('users')
        .insert({ phone, name: name || 'User', email: email || '' })
        .select().single();
      user = newUser;
    }
    return res.json({ token: user.id, name: user.name, phone: user.phone });
  }

  // EMAIL OTP — Resend custom code (used for signin + register)
  if (type === 'email' || email) {
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const { data: otps } = await supabase.from('otp_codes').select('*')
      .eq('phone', email).eq('code', code).eq('used', false)
      .gte('expires_at', new Date().toISOString()).limit(1);

    if (!otps || otps.length === 0) return res.status(400).json({ error: 'Invalid or expired code' });

    await supabase.from('otp_codes').update({ used: true }).eq('id', otps[0].id);

    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (!user) {
      const cleaned = (phone || '').replace(/\D/g, '');
      const formatted = cleaned ? (cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned) : '';
      const { data: newUser } = await supabase.from('users')
        .insert({ email, phone: formatted, name: name || 'User' })
        .select().single();
      user = newUser;
    }
    return res.json({ token: user.id, name: user.name, phone: user.phone, email: user.email });
  }

  return res.status(400).json({ error: 'Email or phone required' });
};