const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Auto-assign a free eTag to a new user
// IMPORTANT:
//   - Free eTags use TMC-ET prefix to distinguish from physical TMC- stickers
//   - Tags marked with tag_type='etag' are NEVER pulled from physical inventory
//   - Limit: 1 free eTag per user account ever
async function assignFreeTag(userId) {
  try {
    // 1. Check if user already has ANY tag - don't double-assign
    const { data: existingTags } = await supabase
      .from('tags')
      .select('token, tag_type, status')
      .eq('owner_id', userId)
      .neq('status', 'deleted')
      .limit(1);

    if (existingTags && existingTags.length > 0) {
      console.log('User', userId, 'already has tag', existingTags[0].token, '- skipping free eTag generation');
      return existingTags[0].token;
    }

    // 2. Generate a fresh eTag with TMC-ET prefix
    //    NOTE: We do NOT pull from unclaimed physical inventory.
    //    Physical tags are reserved for paying users only.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let attempt = 0;
    let newToken = null;

    while (attempt < 5 && !newToken) {
      attempt++;
      let random = '';
      for (let i = 0; i < 5; i++) {
        random += chars[Math.floor(Math.random() * chars.length)];
      }
      const candidate = 'TMC-ET' + random;

      const { data: existing } = await supabase
        .from('tags')
        .select('token')
        .eq('token', candidate)
        .limit(1);

      if (!existing || existing.length === 0) {
        newToken = candidate;
      }
    }

    if (!newToken) {
      console.error('Could not generate unique eTag token after 5 attempts');
      return null;
    }

    // 3. Insert the new eTag with tag_type='etag' so admin can filter
    const { data: newTag, error } = await supabase
      .from('tags')
      .insert({
        token: newToken,
        status: 'claimed',
        owner_id: userId,
        claimed_at: new Date().toISOString(),
        plan: 'etag',
        tag_type: 'etag',
        vehicle_label: 'My Vehicle'
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to generate eTag:', error);
      return null;
    }

    console.log('Generated free eTag', newToken, 'for user', userId);
    return newToken;

  } catch(e) {
    console.error('Free eTag assignment error:', e);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // mode: 'signin' = user must already exist (don't auto-create)
  // mode: 'register' = create user if not exists (default legacy behavior)
  const { email, phone, code, name, token, type, mode } = req.body;

  // PHONE OTP — Twilio Verify (used for tag activation)
  if (type === 'phone') {
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verificationChecks.create({ to: phone, code });
      if (check.status !== 'approved') return res.status(400).json({ error: 'Invalid or expired code' });
    } catch(e) { return res.status(400).json({ error: 'Invalid or expired code' }); }

    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
    let isNewUser = false;
    if (!user) {
      const { data: newUser } = await supabase.from('users')
        .insert({ phone, name: name || 'User', email: email || '' })
        .select().single();
      user = newUser;
      isNewUser = true;
    }
    if (isNewUser && user) await assignFreeTag(user.id);
    return res.json({ token: user.id, name: user.name, phone: user.phone });
  }

  // EMAIL OTP — signin or register
  if (type === 'email' || email) {
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    // Find the most recent unused OTP for this email
    const { data: otps } = await supabase.from('otp_codes').select('*')
      .eq('phone', email)
      .eq('code', code)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!otps || otps.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code. Please request a new one.' });
    }

    const otp = otps[0];
    const expiresAt = new Date(otp.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    await supabase.from('otp_codes').delete().eq('phone', email).eq('used', false);

    // Check if user exists
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    let isNewUser = false;

    // ─── SIGNIN MODE: reject if user doesn't exist ──────────────
    if (mode === 'signin' && !user) {
      return res.status(404).json({
        error: 'No account found for this email. Please register first.',
        no_account: true
      });
    }

    // ─── REGISTER MODE (or legacy): create user if not exists ──
    if (!user) {
      const cleaned = (phone || '').replace(/\D/g, '');
      const formatted = cleaned ? (cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned) : null;
      const { data: newUser, error: insertError } = await supabase.from('users')
        .insert({ email, phone: formatted, name: name || 'User' })
        .select().single();

      if (insertError) {
        console.error('User insert error:', insertError);
        const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).single();
        if (existingUser) {
          user = existingUser;
        } else {
          return res.status(500).json({ error: 'Failed to create account. Please try again.' });
        }
      } else {
        user = newUser;
        isNewUser = true;
      }
    }

    if (!user) return res.status(500).json({ error: 'Account error. Please try again.' });

    // Auto-assign tag and generate referral code for new users
    if (isNewUser && user) {
      await assignFreeTag(user.id);
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let refCode = "TMC-";
      for (let i = 0; i < 6; i++) refCode += chars[Math.floor(Math.random() * chars.length)];
      const updates = { referral_code: refCode };
      if (token) updates.referred_by = token;
      await supabase.from('users').update(updates).eq('id', user.id);
    }

    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      isNewUser
    });
  }

  return res.status(400).json({ error: 'type or email required' });
};
