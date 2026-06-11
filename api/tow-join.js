// TMC_TOW_JOIN: driver taps the manager-provided link -> sets cookie linking
// this device to the towing company. Cookie lives for 1 year.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-join:ip:' + ip, max: 50, windowSeconds: 3600 }])) return;

  const code = String(req.query.co || '').trim().toUpperCase();
  if (!code || !/^[A-Z2-9]{4,12}$/.test(code))
    return res.status(400).json({ error: 'Invalid code' });

  const { data, error } = await supabase
    .from('tow_companies')
    .select('code, company_name, phone, address')
    .eq('code', code).eq('active', true).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Code not found or inactive' });

  // Set device cookie: 1 year, HttpOnly + SameSite=Lax (Lax so NFC opens still send it)
  const host = String(req.headers.host || '');
  const isProd = !host.includes('localhost') && !host.includes('127.0.0.1');
  const parts = ['tmc_tow_co=' + code, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=31536000'];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));

  return res.json({ ok: true, company_name: data.company_name, phone: data.phone, address: data.address || '' });
};
