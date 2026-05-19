const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

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
        random += chars[crypto.randomInt(chars.length)];
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
    // TMC_PATCH5_ACTIVATION_SESSION
    // status='claimed' is the DELIBERATE placeholder state. The eTag is
    // owned by this user but is NOT yet usable by strangers. The user
    // must explicitly activate it via activate.html with an SMS-verified
    // one-shot session token (see Patch 5 + Patch 7).
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

  // TMC_PATCH3_RATE_LIMIT
  const _tmcIp = getClientIp(req);
  const _tmcRateRules = [
    { key: 'verify-otp:ip:' + _tmcIp, max: 10, windowSeconds: 60 }
  ];
  if (!await rateLimit(req, res, _tmcRateRules)) return;


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
  // TMC_PATCH2_OTP_VERIFY_HARDENED
  if (type === 'email' || email) {
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    // ─── Per-email lockout check (before any DB work) ────────────
    try {
      const { data: lockRow } = await supabase
        .from('otp_lockouts')
        .select('locked_until')
        .eq('email', email)
        .maybeSingle();
      if (lockRow) {
        const until = new Date(lockRow.locked_until).getTime();
        if (Date.now() < until) {
          const minsLeft = Math.max(1, Math.ceil((until - Date.now()) / 60000));
          return res.status(429).json({
            error: 'Too many failed attempts. Please try again in ' + minsLeft + ' minute' + (minsLeft === 1 ? '' : 's') + '.',
            locked: true
          });
        }
      }
    } catch (e) {
      // fail-open: don't block legitimate users if lockouts table query fails
    }

    // Find the most recent unused OTP for this email (any code value)
    // We DON'T filter by code here so we can count this as an attempt
    // even if the user typed the wrong code.
    const { data: otps } = await supabase.from('otp_codes').select('*')
      .eq('phone', email)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!otps || otps.length === 0) {
      return res.status(400).json({ error: 'No active code found. Please request a new one.' });
    }

    const otp = otps[0];
    const expiresAt = new Date(otp.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    // ─── Compare submitted code to stored code ───────────────────
    if (String(code).trim() !== String(otp.code)) {
      // Wrong code — increment attempts
      const newAttempts = (otp.attempts || 0) + 1;
      const MAX_ATTEMPTS = 5;

      if (newAttempts >= MAX_ATTEMPTS) {
        // Exhaust this OTP
        await supabase.from('otp_codes')
          .update({ used: true, attempts: newAttempts, exhausted_at: new Date().toISOString() })
          .eq('id', otp.id);

        // ─── Per-email cooldown trigger ────────────────────────
        // Count exhausted OTPs for this email in last 15 min.
        const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: recentExhausted } = await supabase.from('otp_codes')
          .select('id')
          .eq('phone', email)
          .gte('exhausted_at', fifteenMinAgo);

        const exhaustedCount = (recentExhausted || []).length;
        if (exhaustedCount >= 3) {
          // Lock the email out for 15 minutes
          const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await supabase.from('otp_lockouts').upsert({
            email,
            locked_until: lockUntil,
            reason: 'repeated_otp_failures',
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' });
          return res.status(429).json({
            error: 'Too many failed attempts. Please try again in 15 minutes.',
            locked: true
          });
        }

        return res.status(400).json({
          error: 'Too many wrong attempts. Please request a new code.',
          attempts_exhausted: true
        });
      } else {
        await supabase.from('otp_codes')
          .update({ attempts: newAttempts })
          .eq('id', otp.id);
        const remaining = MAX_ATTEMPTS - newAttempts;
        return res.status(400).json({
          error: 'Wrong code. ' + remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' left.',
          attempts_remaining: remaining
        });
      }
    }

    // ─── Correct code path ───────────────────────────────────────
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    await supabase.from('otp_codes').delete().eq('phone', email).eq('used', false);
    // Clear any stale lockout row for this email
    await supabase.from('otp_lockouts').delete().eq('email', email);

    // Check if user exists
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    let isNewUser = false;

    // SIGNIN MODE: reject if user doesn't exist
    if (mode === 'signin' && !user) {
      return res.status(404).json({
        error: 'No account found for this email. Please register first.',
        no_account: true
      });
    }

    // REGISTER MODE (or legacy): create user if not exists
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
      for (let i = 0; i < 6; i++) refCode += chars[crypto.randomInt(chars.length)];
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
