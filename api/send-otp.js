const { createClient } = require('@supabase/supabase-js');

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

  try {
    // Send OTP via Supabase email — completely free
    const { error } = await supabase.auth.signInWithOtp({
  email: email,
  options: {
    shouldCreateUser: true,
    emailRedirectTo: null,
    data: { name, phone }
  }
});
    if (error) {
      console.error('Supabase OTP error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Send OTP error:', err.message);
    res.status(500).json({ error: err.message });
  }
};