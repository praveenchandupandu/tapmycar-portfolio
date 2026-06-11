// TMC_TOW_VERIFY_TOKEN: validates magic link token, sets admin session cookie.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-verify:ip:' + ip, max: 20, windowSeconds: 600 }])) return;

  const token = String(req.query.t || '').trim();
  if (!token || !/^[a-f0-9]{32,80}$/.test(token))
    return res.status(400).json({ error: 'Invalid token' });

  const { data: co } = await supabase
    .from('tow_companies')
    .select('id, code, company_name, signin_expires')
    .eq('signin_token', token).eq('active', true).maybeSingle();
  if (!co) return res.status(404).json({ error: 'Link is invalid or already used' });

  if (!co.signin_expires || new Date(co.signin_expires).getTime() < Date.now())
    return res.status(410).json({ error: 'Link has expired. Request a new one.' });

  // Create admin session (30 days)
  const sessionToken = crypto.randomBytes(32).toString('hex'); // 64 chars
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('tow_companies').update({
    admin_session_token: sessionToken,
    admin_session_expires: sessionExpires,
    signin_token: null, signin_expires: null  // one-time use
  }).eq('id', co.id);

  const host = String(req.headers.host || '');
  const isProd = !host.includes('localhost') && !host.includes('127.0.0.1');
  const parts = ['tmc_tow_admin=' + sessionToken, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));

  return res.json({ ok: true, company_name: co.company_name });
};
