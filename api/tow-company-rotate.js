// TMC_TOW_ROTATE: rotate company code (kills old, generates new). Requires admin session.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len) {
  let c = ''; for (let i = 0; i < len; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}
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

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-rotate:ip:' + ip, max: 5, windowSeconds: 3600 }])) return;

  const session = String(readCookie(req, 'tmc_tow_admin') || '').trim();
  if (!session) return res.status(401).json({ error: 'Sign in first' });

  const { data: co } = await supabase
    .from('tow_companies')
    .select('id, code, admin_session_expires')
    .eq('admin_session_token', session).eq('active', true).maybeSingle();
  if (!co) return res.status(401).json({ error: 'Session invalid' });
  if (new Date(co.admin_session_expires).getTime() < Date.now())
    return res.status(401).json({ error: 'Session expired' });

  // Generate new unique code
  let newCode = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    newCode = generateCode(6);
    const { data: dupe } = await supabase
      .from('tow_companies').select('id').eq('code', newCode).maybeSingle();
    if (!dupe) break;
    newCode = '';
  }
  if (!newCode) return res.status(500).json({ error: 'Could not generate new code' });

  const oldCode = co.code;
  await supabase.from('tow_companies').update({
    code: newCode, rotated_from: oldCode
  }).eq('id', co.id);

  return res.json({ ok: true, code: newCode, url: 'https://tapmycar.io/join.html?co=' + newCode });
};
