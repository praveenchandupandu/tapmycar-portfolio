// TMC_VERIFY_SOLO  per-token status lookup for the independent verify UI.
// Returns { ok, results: [{ token, exists, status, verified, ... }] }
const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const tokensIn = (req.body && req.body.tokens) || [];
  if (!Array.isArray(tokensIn) || tokensIn.length === 0) return res.status(400).json({ error: 'tokens array required' });
  if (tokensIn.length > 1000) return res.status(400).json({ error: 'Max 1000 tokens per request' });

  const cleaned = tokensIn.map(function (t) { return String(t).toUpperCase().trim(); }).filter(function (t) { return /^TMC-[A-Z0-9]+$/.test(t); });
  if (cleaned.length === 0) return res.status(400).json({ error: 'No valid token formats' });

  const { data, error } = await supabase
    .from('tags')
    .select('token, status, verified, verified_at, batch_number, owner_id')
    .in('token', cleaned);

  if (error) return res.status(500).json({ error: error.message });

  const byToken = {};
  (data || []).forEach(function (r) { byToken[r.token] = r; });

  const results = cleaned.map(function (t) {
    const r = byToken[t];
    if (!r) return { token: t, exists: false, status: 'missing' };
    return {
      token:        r.token,
      exists:       true,
      status:       r.status,
      verified:     !!r.verified,
      verified_at:  r.verified_at,
      batch_number: r.batch_number,
      claimed:      !!r.owner_id
    };
  });
  return res.json({ ok: true, results: results });
};
