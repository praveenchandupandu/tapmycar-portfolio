// TMC_TOW_COMPANY_CREATE: manager submits company info -> get unique code + URL.
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len) {
  let c = '';
  for (let i = 0; i < len; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}
function esc(s) { return String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-co-create:ip:' + ip, max: 3, windowSeconds: 3600 }])) return;

  const b = req.body || {};
  const company_name = String(b.company_name || '').trim().slice(0, 200);
  const phone        = String(b.phone || '').trim().slice(0, 60);
  const address      = String(b.address || '').trim().slice(0, 400);
  const admin_email  = String(b.admin_email || '').trim().toLowerCase().slice(0, 200);

  if (!company_name || !phone || !admin_email)
    return res.status(400).json({ error: 'company_name, phone, and admin_email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin_email))
    return res.status(400).json({ error: 'Invalid email' });

  // Generate unique 6-char code (~1B combinations, no confusing chars)
  let code = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    code = generateCode(6);
    const { data: dupe } = await supabase
      .from('tow_companies').select('id').eq('code', code).maybeSingle();
    if (!dupe) break;
    code = '';
  }
  if (!code) return res.status(500).json({ error: 'Could not generate unique code' });

  // Generate admin session token so they auto-land on the dashboard
  const adminSession = require('crypto').randomBytes(32).toString('hex');
  const adminExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tow_companies')
    .insert({
      code, company_name, phone, address: address || null, admin_email, active: true,
      admin_session_token: adminSession, admin_session_expires: adminExpires
    })
    .select('code')
    .single();
  if (error) return res.status(500).json({ error: 'Failed to create company' });

  // Set HttpOnly admin session cookie  manager is auto-signed-in
  const host = String(req.headers.host || '');
  const isProd = !host.includes('localhost') && !host.includes('127.0.0.1');
  const cookieParts = ['tmc_tow_admin=' + adminSession, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'];
  if (isProd) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));

  const driverUrl = 'https://tapmycar.io/join.html?co=' + code;

  // Email manager
  try {
    const html =
      '<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 22px;color:#111">' +
        '<div style="font-size:24px;font-weight:800;margin-bottom:4px">TapMyCar<span style="color:#FF6B00">.</span></div>' +
        '<div style="font-size:12px;color:#6B7280;margin-bottom:22px">For towing companies</div>' +
        '<div style="background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:14px;padding:18px;margin-bottom:18px">' +
          '<div style="font-size:11px;font-weight:800;color:#9A3412;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Your team driver link</div>' +
          '<div style="font-size:18px;font-weight:800;color:#7C2D12;line-height:1.3;margin-bottom:8px">' + esc(company_name) + ' is set up</div>' +
          '<div style="font-size:14px;color:#9A3412;line-height:1.6;margin-bottom:14px">Share this link with every driver on your team. They tap it once on their phone, then every TapMyCar sticker they scan automatically notifies the car owner with your company info.</div>' +
          '<div style="background:#fff;border:1px solid #FED7AA;border-radius:10px;padding:14px;font-family:monospace;font-size:14px;font-weight:700;color:#7C2D12;word-break:break-all;text-align:center">' + esc(driverUrl) + '</div>' +
        '</div>' +
        '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:14px;font-size:12px;color:#1E40AF;line-height:1.6">' +
          '<b>Save this email.</b> It is your record of the URL. If a driver leaves or the link gets shared too widely, email <a href="mailto:support@tapmycar.io" style="color:#1E40AF">support@tapmycar.io</a> and we will rotate the code.' +
        '</div>' +
        '<div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:22px">Praman Tech LLC · Connecticut, USA</div>' +
      '</div>';
    await resend.emails.send({
      from: 'TapMyCar <noreply@tapmycar.io>',
      to: admin_email,
      subject: 'Your TapMyCar driver link for ' + company_name,
      html
    });
  } catch (e) { console.error('email failed:', e && e.message); }

  return res.json({ ok: true, code: data.code, url: driverUrl, company_name: company_name });
};
