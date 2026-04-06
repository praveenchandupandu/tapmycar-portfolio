const { createClient } = require('@supabase/supabase-js');

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

  try {
    // Verify OTP with Supabase
    const { data, error } = await supabaseAuth.auth.verifyOtp({
      email,
      token: code,
      type: 'email'
    });

    if (error) {
      console.error('Verify error:', error.message);
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const supabaseUserId = data.user.id;

    // Find or create user in our users table
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
          phone: phone || '',
          name: name || 'User',
          supabase_id: supabaseUserId
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

  } catch (err) {
    console.error('Verify OTP error:', err.message);
    res.status(500).json({ error: err.message });
  }
};