// TMC_PATCH20_AUDIT_AND_OPS
// /api/get-audit-log — admin-only, returns recent audit log entries.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  /* TMC_PATCH39: accept the admin key from the x-admin-key header
     (preferred — keeps it out of the URL and logs) or the legacy
     ?admin= query param. */
  const { limit } = req.query;
  const admin = (req.headers && req.headers['x-admin-key']) || req.query.admin;
  if (admin !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const lim = Math.min(Math.max(parseInt(limit || '100', 10) || 100, 1), 500);

  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(lim);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, entries: data || [] });
};
