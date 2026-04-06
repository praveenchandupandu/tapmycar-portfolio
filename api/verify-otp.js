const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, code, name, phone } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code required' });
  }

  // Find OTP
  const { data: otps } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', email)
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .limit(1);

  if (!otps || otps.length === 0) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }

  // Mark as used
  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', otps[0].id);

  // Find or create user
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (!user) {
    const cleaned = (phone || '').replace(/\D/g, '');
    const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        email,
        phone: formatted,
        name: name || 'User'
      })
      .select()
      .single();

    if (insertError) {
      console.error('User insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create user' });
    }

    user = newUser;

    // Create first tag
    await supabase
      .from('tags')
      .insert({
        user_id: user.id,
        vehicle_label: 'My Vehicle',
        status: 'inactive'
      });
  }

  res.json({
    token: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone
  });
};