// TMC_TOW_ADMIN_SELF: returns current admin's company info from session cookie.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function readCookie(req, name) {
  const h = req.headers && req.headers.cookie; if (!h) return null;
  const parts = h.split(';');
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq < 0) continue;
    if (parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = String(readCookie(req, 'tmc_tow_admin') || '').trim();
  if (!session || session.length < 32) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, signed_in: false });
  }

  const { data, error } = await supabase
    .from('tow_companies')
    .select('id, code, company_name, phone, address, admin_email, admin_session_expires, notifications_sent, created_at')
    .eq('admin_session_token', session).eq('active', true).maybeSingle();

  if (error || !data || !data.admin_session_expires || new Date(data.admin_session_expires).getTime() < Date.now()) {
    res.setHeader('Set-Cookie', 'tmc_tow_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, signed_in: false, expired: true });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true, signed_in: true,
    company: {
      code: data.code, company_name: data.company_name, phone: data.phone,
      address: data.address || '', admin_email: data.admin_email,
      driver_url: 'https://tapmycar.io/join.html?co=' + data.code,
      notifications_sent: data.notifications_sent || 0,
      created_at: data.created_at
    }
  });
};
