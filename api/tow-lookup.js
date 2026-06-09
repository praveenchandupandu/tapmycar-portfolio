// TMC_TOW_LOOKUP: public plate lookup. Returns minimal info  no exact address,
// no owner identity. 7-day window. Rate limited per IP to prevent enumeration.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { rateLimit, getClientIp } = require('./_rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!await rateLimit(req, res, [{ key: 'tow-lookup:ip:' + ip, max: 20, windowSeconds: 3600 }])) return;

  const plate = String(req.query.plate || '').trim().toUpperCase().slice(0, 20);
  if (!plate || plate.length < 2) return res.status(400).json({ error: 'plate required' });

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('tow_notifications')
    .select('tow_company_name, tow_company_phone, created_at')
    .eq('license_plate', plate)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return res.status(500).json({ error: 'Lookup failed' });

  if (!data || data.length === 0) {
    return res.json({ ok: true, found: false });
  }
  const n = data[0];
  return res.json({
    ok: true,
    found: true,
    company: n.tow_company_name,
    company_phone: n.tow_company_phone || null,
    when: n.created_at
  });
};
