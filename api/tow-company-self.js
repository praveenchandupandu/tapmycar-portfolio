// TMC_TOW_COMPANY_SELF: returns the current device's linked company (if any).
// Used by /towing.html on load to decide what to show.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    if (parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = String(readCookie(req, 'tmc_tow_co') || '').trim().toUpperCase();
  if (!code) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, linked: false });
  }

  const { data, error } = await supabase
    .from('tow_companies')
    .select('code, company_name, phone, address')
    .eq('code', code).eq('active', true).maybeSingle();

  if (error || !data) {
    // Stale or revoked cookie -> clear it so /towing.html doesn't loop
    // TMC_HARDEN_CLEAR
    const host = String(req.headers.host || '');
    const isProd = !host.includes('localhost') && !host.includes('127.0.0.1');
    const clearParts = ['tmc_tow_co=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
    if (isProd) clearParts.push('Secure');
    res.setHeader('Set-Cookie', clearParts.join('; '));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, linked: false, revoked: true });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true, linked: true,
    code: data.code, company_name: data.company_name, phone: data.phone, address: data.address || ''
  });
};
