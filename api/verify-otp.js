const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, code, name, phone, token: tagToken } = req.body;
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

  // Mark OTP as used
  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', otps[0].id);

  // Clean phone number
  const cleaned = (phone || '').replace(/\D/g, '');
  const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  // Find or create user
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (!user) {
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

    // If tag token provided — claim that tag
    if (tagToken) {
      await supabase
        .from('tags')
        .update({
          status: 'active',
          owner_id: user.id,
          claimed_at: new Date().toISOString(),
          activated_at: new Date().toISOString()
        })
        .eq('token', tagToken.toUpperCase())
        .eq('status', 'unclaimed');
    } else {
      // Create a new tag for normal dashboard registration
      const newToken = generateToken();
      await supabase
        .from('tags')
        .insert({
          token: newToken,
          owner_id: user.id,
          status: 'inactive',
          vehicle_label: 'My Vehicle'
        });
    }
  }

  res.json({
    token: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone
  });
};