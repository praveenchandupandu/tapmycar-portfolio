const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// TMC_PATCH2_OTP_LOCKOUT_HELPER
// Checks otp_lockouts table. Returns null if not locked, or a
// human-readable error string if locked. Defensive: if the table
// doesn't exist or query fails, fail-open (returns null) to avoid
// breaking signup if migration hasn't run.
async function checkLockout(email) {
  try {
    const { data: row, error } = await supabase
      .from('otp_lockouts')
      .select('locked_until')
      .eq('email', email)
      .maybeSingle();
    if (error || !row) return null;
    const until = new Date(row.locked_until).getTime();
    if (Date.now() >= until) return null;
    const minsLeft = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    return 'Too many failed attempts. Please try again in ' + minsLeft + ' minute' + (minsLeft === 1 ? '' : 's') + '.';
  } catch (e) {
    return null;
  }
}

// TMC_PATCH2_EMAIL_VALIDATE
// RFC-lite email format check. Rejects obviously malformed strings
// before we hand them to Resend or write them to the DB.
function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 5 || s.length > 254) return false;
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(s);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // mode: 'signin' = check that email exists before sending OTP
  // mode: 'register' = allow any email (default)
  const { email, phone, type, mode } = req.body;

  // EMAIL OTP
  if (type === 'email' || (!type && email)) {
    if (!email) return res.status(400).json({ error: 'Email required' });

    // TMC_PATCH2_EMAIL_VALIDATE — reject malformed emails
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // TMC_PATCH2_OTP_LOCKOUT_CHECK_BEFORE_ISSUE — block locked-out emails before issuing
    const lockMsg = await checkLockout(email);
    if (lockMsg) {
      return res.status(429).json({ error: lockMsg, locked: true });
    }

    // SIGNIN MODE: verify user exists first
    if (mode === 'signin') {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!existingUser) {
        return res.status(404).json({
          error: 'No account found for this email. Please register first.',
          no_account: true
        });
      }
    }

    const code = crypto.randomInt(100000, 1000000).toString();

    // Delete old OTPs for this email (and start fresh attempts counter)
    const { error: delError } = await supabase
      .from('otp_codes')
      .delete()
      .eq('phone', email);
    if (delError) console.error('Delete old OTPs error:', delError);

    // Insert new OTP
    const { error: insError } = await supabase
      .from('otp_codes')
      .insert({
        phone: email,
        code,
        used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
    if (insError) {
      console.error('Insert OTP error:', insError);
      return res.status(500).json({ error: 'Failed to save OTP' });
    }

    // Send via Resend
    try {
      await resend.emails.send({
        from: 'TapMyCar <noreply@tapmycar.io>',
        to: email,
        subject: 'Your TapMyCar verification code: ' + code,
        html: '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px"><div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div><div style="font-size:14px;color:#6B7280;margin-bottom:32px">Privacy for you. Safety for your car.</div><div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px"><div style="font-size:13px;color:#9A3800;font-weight:600;margin-bottom:8px">Your verification code</div><div style="font-size:42px;font-weight:800;color:#FF6B00;letter-spacing:8px;font-family:Menlo,monospace">' + code + '</div></div><div style="font-size:12px;color:#9CA3AF;text-align:center">Code expires in 10 minutes. If you did not request this, you can ignore this email.</div></div>'
      });
    } catch (e) {
      console.error('Resend error:', e);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.json({ success: true });
  }

  // PHONE OTP — Twilio Verify (used for tag activation, untouched by Patch 2)
  if (type === 'phone') {
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verifications.create({ to: phone, channel: 'sms' });
      return res.json({ success: true });
    } catch (e) {
      console.error('Twilio Verify error:', e);
      return res.status(500).json({ error: 'Failed to send SMS' });
    }
  }

  return res.status(400).json({ error: 'type or email required' });
};
