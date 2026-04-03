const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, code, name } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code required' });
  }

  const cleaned = phone.replace(/\D/g, '');
  const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  const { data: otps } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', formatted)
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .limit(1);

  if (!otps || otps.length === 0) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }

  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('id', otps[0].id);

  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('phone', formatted)
    .single();

  if (!user) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({ phone: formatted, name: name || 'User' })
      .select()
      .single();
    user = newUser;

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
    phone: user.phone
  });
};