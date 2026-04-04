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

  const { phone, code, name } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code required' });
  }

  const cleaned = phone.replace(/\D/g, '');
  const formatted = cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned;

  try {
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({
        to: formatted,
        code: code
      });

    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('phone', formatted)
      .single();

    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({ phone: formatted, name: name || 'User' })
        .select()
        .single();

      if (insertError) {
        console.error('User insert error:', insertError);
        return res.status(500).json({ error: 'Failed to create user' });
      }

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

  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
