// TMC_TOW_SIGNIN: send magic link to manager's email.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

function esc(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-signin:ip:' + ip, max: 5, windowSeconds: 600 }])) return;

  const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please enter a valid email.' });

  // Always return ok (don't reveal whether an email is registered)
  // Look up company
  const { data: co } = await supabase
    .from('tow_companies')
    .select('id, code, company_name, admin_email')
    .eq('admin_email', email).eq('active', true).maybeSingle();

  if (co) {
    const token = crypto.randomBytes(24).toString('hex'); // 48 chars
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
    await supabase.from('tow_companies')
      .update({ signin_token: token, signin_expires: expires })
      .eq('id', co.id);

    const link = 'https://tapmycar.io/towing-signin.html?t=' + token;
    try {
      const html =
        '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 22px;color:#111">' +
          '<div style="font-size:24px;font-weight:800;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
          '<div style="font-size:12px;color:#6B7280;margin-bottom:22px">Sign in to ' + esc(co.company_name) + '</div>' +
          '<div style="background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:14px;padding:18px;margin-bottom:18px">' +
            '<div style="font-size:14px;color:#7C2D12;line-height:1.6;margin-bottom:14px">Tap the button below to sign in. The link works for 30 minutes and only once.</div>' +
            '<a href="' + link + '" style="display:block;background:#FF6B00;color:#fff;font-weight:800;font-size:14px;padding:14px 0;border-radius:12px;text-align:center;text-decoration:none">Sign in to your dashboard</a>' +
          '</div>' +
          '<div style="font-size:11px;color:#9CA3AF;line-height:1.55">If you did not request this email, ignore it  no changes were made.</div>' +
          '<div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:22px">Praman Tech LLC · Connecticut, USA</div>' +
        '</div>';
      await resend.emails.send({
        from: 'TapMyCar <noreply@tapmycar.io>',
        to: email, subject: 'Sign in to your TapMyCar tow company dashboard', html
      });
    } catch (e) { console.error('signin email failed:', e && e.message); }
  }

  return res.json({ ok: true });
};
