// TMC_TOW_SIGNOUT: clear admin session cookie + token.
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = String(readCookie(req, 'tmc_tow_admin') || '').trim();
  if (session) {
    await supabase.from('tow_companies').update({
      admin_session_token: null, admin_session_expires: null
    }).eq('admin_session_token', session);
  }
  res.setHeader('Set-Cookie', 'tmc_tow_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return res.json({ ok: true });
};
